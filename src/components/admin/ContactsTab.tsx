import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Download, Mail, Phone, RefreshCw, Search } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime, num, STATE_CLS, STATE_LABEL } from '@/components/admin/adminApi';
import type { AdminUser } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';

// Listas de contatos para trabalhar fora do sistema (WhatsApp, planilha, campanha):
// telefone e e-mail de cada grupo, com copiar e exportar em CSV.
//
// Quem já pagou alguma vez: tem pagamento registrado (pix_paid_until, de InfinitePay ou
// manual), data de assinatura (subscribed_at) ou origem de pagamento real. Bônus, parceiro e
// teste não contam como pagamento. Administradores ficam fora de todas as listas.

type ListId = 'trial_no_sub' | 'churned' | 'active' | 'partners' | 'all';

const LISTS: Array<{ id: ListId; label: string; hint: string }> = [
  { id: 'trial_no_sub', label: 'Testaram e não assinaram', hint: 'O teste grátis acabou e a pessoa nunca pagou.' },
  { id: 'churned', label: 'Eram assinantes e saíram', hint: 'Já pagou alguma vez e hoje está sem acesso.' },
  { id: 'active', label: 'Assinantes', hint: 'Com acesso pago agora. Parceiros ficam na lista deles.' },
  { id: 'partners', label: 'Parceiros', hint: 'Contas marcadas como parceiras, com acesso liberado.' },
  { id: 'all', label: 'Geral', hint: 'Todas as contas, em qualquer situação.' },
];

const PAGE = 200;

function everPaid(u: AdminUser): boolean {
  return Boolean(u.pix_paid_until) || Boolean(u.subscribed_at) || u.payment_source === 'legacy' || u.payment_source === 'manual' || u.payment_source === 'infinitepay';
}

function inList(u: AdminUser, list: ListId): boolean {
  if (u.is_admin) return false;
  // Parceiro é parceiro: só aparece na lista dele (e na geral), nunca como assinante ou cliente.
  if (list === 'partners') return Boolean(u.partner);
  if (list !== 'all' && u.partner) return false;
  switch (list) {
    case 'trial_no_sub':
      return u.state === 'expired' && !everPaid(u) && Boolean(u.trial_started_at);
    case 'churned':
      return u.state === 'expired' && everPaid(u);
    case 'active':
      return u.state === 'active';
    default:
      return true;
  }
}

/**
 * Lista no formato do disparo do Whatts Bot: uma pessoa por linha, "Nome, 5511999999999"
 * (sem +; o robô completa o 55 sozinho se faltar). Vírgula no nome viraria separador, então sai.
 */
function botLines(list: AdminUser[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of list) {
    const digits = cleanPhone(u.phone).replace(/\D/g, '');
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    const name = String(u.name ?? '').replace(/[,;\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    out.push(name ? `${name}, ${digits}` : digits);
  }
  return out.join('\n');
}

/** Telefone só com dígitos e o +, do jeito que o WhatsApp e as planilhas entendem. */
function cleanPhone(phone: string | null): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 10 || d.length === 11 ? `+55${d}` : `+${d}`;
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/** Data em dd/mm/aaaa para a planilha (vazio quando não tem). */
function day(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

export default function ContactsTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<ListId>('trial_no_sub');
  const [search, setSearch] = useState('');
  const [onlyPhone, setOnlyPhone] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Busca a base inteira em páginas de 200 (o máximo do admin_users).
      const all: AdminUser[] = [];
      for (let offset = 0; offset < 50000; offset += PAGE) {
        const { total, rows } = await adminApi.users('', '', PAGE, offset);
        all.push(...rows);
        if (rows.length < PAGE || all.length >= total) break;
      }
      setUsers(all);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c: Record<ListId, number> = { trial_no_sub: 0, churned: 0, active: 0, partners: 0, all: 0 };
    for (const u of users ?? []) for (const l of LISTS) if (inList(u, l.id)) c[l.id]++;
    return c;
  }, [users]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (!inList(u, list)) return false;
      if (onlyPhone && !cleanPhone(u.phone)) return false;
      if (!q) return true;
      return [u.name, u.email, u.phone].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [users, list, search, onlyPhone]);

  const phones = useMemo(() => [...new Set(rows.map((u) => cleanPhone(u.phone)).filter(Boolean))], [rows]);
  const emails = useMemo(() => [...new Set(rows.map((u) => u.email).filter(Boolean))], [rows]);
  const current = LISTS.find((l) => l.id === list)!;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navegador sem permissão de área de transferência: cai no jeito antigo.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 2500);
  };

  const exportCsv = () => {
    const header = ['nome', 'telefone', 'email', 'situacao', 'conta_criada', 'fim_do_teste', 'pago_ate', 'ja_pagou'];
    const lines = rows.map((u) => [
      u.name ?? '',
      cleanPhone(u.phone),
      u.email,
      STATE_LABEL[u.state] ?? u.state,
      day(u.created_at),
      day(u.trial_ends_at),
      day(u.pix_paid_until ?? u.current_period_end),
      everPaid(u) ? 'sim' : 'não',
    ].map(csvCell).join(','));
    const csv = '﻿' + header.join(',') + '\n' + lines.join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vs-stage-${list.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Listas de contatos</h2>
          <p className="text-xs text-logic-text-dim">
            Telefone e e-mail de cada grupo, para copiar ou baixar em planilha. Administradores ficam de fora.
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {LISTS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setList(l.id)}
            className={`text-left px-3 py-2.5 rounded-lg border transition ${list === l.id ? 'border-logic-lcd-green/60 bg-logic-lcd-green/10' : 'border-logic-border bg-logic-bg-panel hover:border-logic-border-light'}`}
          >
            <div className={`text-xl font-semibold tabular-nums ${list === l.id ? 'text-logic-lcd-green' : 'text-logic-text'}`}>{users ? num(counts[l.id]) : '…'}</div>
            <div className="text-xs font-medium text-logic-text">{l.label}</div>
          </button>
        ))}
      </div>

      {error && <ErrorBox text={error} />}

      <Panel
        title={current.label}
        actions={<span className="text-2xs text-logic-text-muted">{current.hint}</span>}
      >
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
              <input className={`${input} pl-8`} placeholder="Buscar por nome, e-mail ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-logic-text-dim cursor-pointer select-none">
              <input type="checkbox" className="accent-[var(--logic-accent,#ffab1f)]" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} />
              Só quem tem telefone
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnGhost}
              disabled={!phones.length}
              onClick={() => copy('phones', botLines(rows))}
              title='Uma pessoa por linha, "Nome, 5511999999999": cola direto nos contatos do disparo do Whatts Bot'
            >
              {copied === 'phones' ? <CheckCircle2 size={13} className="text-logic-lcd-green" /> : <Phone size={13} />}
              {copied === 'phones' ? 'Copiado para o robô' : `Copiar ${num(phones.length)} para o robô (nome, telefone)`}
            </button>
            <button type="button" className={btnGhost} disabled={!emails.length} onClick={() => copy('emails', emails.join('\n'))}>
              {copied === 'emails' ? <CheckCircle2 size={13} className="text-logic-lcd-green" /> : <Mail size={13} />}
              {copied === 'emails' ? 'E-mails copiados' : `Copiar ${num(emails.length)} e-mails`}
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={!rows.length}
              onClick={() => copy('both', rows.map((u) => [u.name ?? '', cleanPhone(u.phone), u.email].join('\t')).join('\n'))}
              title="Nome, telefone e e-mail separados por tabulação: cola direto na planilha"
            >
              {copied === 'both' ? <CheckCircle2 size={13} className="text-logic-lcd-green" /> : <Copy size={13} />}
              {copied === 'both' ? 'Copiado' : 'Copiar tudo para planilha'}
            </button>
            <button type="button" className={btnPrimary} disabled={!rows.length} onClick={exportCsv}>
              <Download size={13} /> Exportar CSV ({num(rows.length)})
            </button>
          </div>
        </div>

        {loading && !users ? <Loading /> : rows.length === 0 ? (
          <Empty text={users ? 'Ninguém nesta lista.' : 'Carregando…'} />
        ) : (
          <div className="overflow-x-auto border-t border-logic-border">
            <table className="w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider text-logic-text-muted bg-logic-bg-elevated/30">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Nome</th>
                  <th className="text-left font-semibold px-3 py-2">Telefone</th>
                  <th className="text-left font-semibold px-3 py-2">E-mail</th>
                  <th className="text-left font-semibold px-3 py-2">Situação</th>
                  <th className="text-left font-semibold px-3 py-2">Conta criada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-logic-border/60">
                {rows.slice(0, 500).map((u) => (
                  <tr key={u.id} className="hover:bg-logic-bg-elevated/30">
                    <td className="px-3 py-1.5 text-logic-text">{u.name ?? <span className="text-logic-text-muted">Sem nome</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{cleanPhone(u.phone) || <span className="text-logic-text-muted">sem telefone</span>}</td>
                    <td className="px-3 py-1.5 text-logic-text-dim">{u.email}</td>
                    <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATE_CLS[u.state] ?? ''}`}>{STATE_LABEL[u.state] ?? u.state}</span></td>
                    <td className="px-3 py-1.5 text-logic-text-muted whitespace-nowrap">{dateTime(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && (
              <p className="px-3 py-2 text-2xs text-logic-text-muted border-t border-logic-border">
                Mostrando 500 de {num(rows.length)}. Copiar e exportar levam todos.
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
