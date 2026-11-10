import { useState } from 'react';
import { Ban, Check, KeyRound, Trash2, UserCheck, Users, WifiOff } from 'lucide-react';
import { useStore } from '@/store';
import type { MusicianAccount } from '@/types';

const STATUS_LABEL: Record<MusicianAccount['status'], string> = {
  pending: 'Aguardando aprovação',
  approved: 'Aprovado',
  blocked: 'Bloqueado',
};
const STATUS_TONE: Record<MusicianAccount['status'], string> = {
  pending: 'text-logic-lcd-amber',
  approved: 'text-logic-lcd-green',
  blocked: 'text-logic-lcd-red',
};

type Asking = 'reset' | 'remove';

/**
 * Músicos do show na Rede Local. A lista mora no projeto: quem entrou continua nela depois de
 * salvar e volta ao abrir o projeto. Cada um mostra se está online agora.
 * - Desconectar: derruba agora; continua na lista e entra de novo com usuário e senha.
 * - Excluir: sai da lista (com os cadernos); para voltar, precisa do QR e do PIN dos músicos.
 * `online`: conta -> último sinal; null com a rede local desligada (sem como saber).
 */
export default function MusicianAccountsPanel({ online }: { online: Map<string, number> | null }) {
  const book = useStore((s) => s.musicianBook);
  const setStatus = useStore((s) => s.setMusicianStatus);
  const resetPassword = useStore((s) => s.resetMusicianPassword);
  const removeAccount = useStore((s) => s.removeMusicianAccount);
  const disconnect = useStore((s) => s.disconnectMusician);
  const [confirm, setConfirm] = useState<{ id: string; what: Asking } | null>(null);
  const [dropped, setDropped] = useState<string | null>(null);

  const isOnline = (a: MusicianAccount) => !!online?.has(a.id) && dropped !== a.id;
  const order: Record<MusicianAccount['status'], number> = { pending: 0, approved: 1, blocked: 2 };
  const accounts = [...(book?.accounts ?? [])].sort((a, b) =>
    order[a.status] - order[b.status] || Number(isOnline(b)) - Number(isOnline(a)) || a.name.localeCompare(b.name));
  const pending = accounts.filter((a) => a.status === 'pending').length;
  const onlineCount = accounts.filter(isOnline).length;
  const sheetCount = (a: MusicianAccount) => Object.values(a.sheets ?? {}).filter((s) => !s.deleted).length;

  const doDisconnect = (a: MusicianAccount) => {
    disconnect(a.id);
    // a luz apaga na hora; a lista de conectados do Mac confirma na próxima leitura
    setDropped(a.id);
    window.setTimeout(() => setDropped((d) => (d === a.id ? null : d)), 3000);
  };

  const btn = 'flex items-center gap-1 px-2 h-6 rounded text-2xs transition-colors';

  return (
    <section>
      <h3 className="text-xs font-semibold text-logic-text mb-1 flex flex-wrap items-center gap-2">
        <Users size={13} className="text-logic-lcd-green" /> Músicos do show
        <span className="text-logic-text-muted font-normal">({accounts.length})</span>
        {online && accounts.length > 0 && (
          <span className="flex items-center gap-1.5 font-normal text-2xs text-logic-text-dim">
            <span className={`console-led ${onlineCount > 0 ? 'is-on-green' : ''}`} /> {onlineCount} online
          </span>
        )}
        {pending > 0 && <span className="px-1.5 rounded bg-logic-lcd-amber/20 text-logic-lcd-amber text-2xs font-semibold">{pending} para aprovar</span>}
      </h3>
      <p className="text-2xs text-logic-text-muted mb-2 leading-relaxed">
        Cada músico cria a conta no celular (usuário, senha e o PIN dos músicos) e você aprova aqui. A lista e os cadernos ficam no projeto: salve o projeto e ela volta quando você abrir de novo, com cada músico entrando sozinho pelo celular.
      </p>
      {accounts.length === 0 ? (
        <p className="text-2xs text-logic-text-muted py-4 text-center border border-dashed border-logic-border rounded-lg">
          Nenhum músico criou conta ainda.
        </p>
      ) : (
        <ul className="divide-y divide-logic-border-dark border border-logic-border-dark rounded-lg overflow-hidden">
          {accounts.map((a) => {
            const asking = confirm?.id === a.id ? confirm.what : null;
            const on = isOnline(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 bg-logic-bg-deep/40">
                <span
                  className={`console-led shrink-0 ${on ? 'is-on-green' : ''}`}
                  title={online ? (on ? 'Online agora' : 'Offline') : 'Rede local desligada'}
                />
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-xs text-logic-text truncate">
                    {a.name}{a.instrument && <span className="text-logic-text-muted"> · {a.instrument}</span>}
                  </p>
                  <p className="text-2xs text-logic-text-muted">
                    {online && (on
                      ? <span className="text-logic-lcd-green font-semibold">Online</span>
                      : <span>Offline</span>)}
                    {online && ' · '}
                    <span className="font-mono">{a.username}</span> · <span className={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</span>
                    {!a.passwordHash && a.status !== 'pending' && <span className="text-logic-lcd-amber"> · senha zerada</span>}
                    {' · '}{sheetCount(a)} {sheetCount(a) === 1 ? 'caderno' : 'cadernos'}
                  </p>
                </div>
                {asking ? (
                  <div className="flex flex-wrap items-center gap-1.5 animate-[fadeIn_120ms_ease-out]">
                    <span className="text-2xs text-logic-lcd-amber max-w-[22rem] leading-snug">
                      {asking === 'remove'
                        ? a.status === 'pending'
                          ? 'Recusar o pedido? Para tentar de novo, ele precisa do QR e do PIN dos músicos.'
                          : 'Excluir da lista? Os cadernos dele são apagados e, para voltar, ele precisa do QR e do PIN dos músicos.'
                        : 'Zerar a senha?'}
                    </span>
                    <button className={`${btn} text-logic-text-dim hover:bg-logic-bg-panel-light`} onClick={() => setConfirm(null)}>Cancelar</button>
                    <button
                      className={`${btn} font-semibold ${asking === 'remove' ? 'bg-logic-lcd-red text-white' : 'bg-logic-lcd-amber text-black'} hover:brightness-110`}
                      onClick={() => { if (asking === 'remove') removeAccount(a.id); else resetPassword(a.id); setConfirm(null); }}
                    >
                      {asking === 'remove' ? (a.status === 'pending' ? 'Recusar' : 'Excluir') : 'Zerar'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {a.status !== 'approved' && (
                      <button className={`${btn} bg-logic-lcd-green/15 text-logic-lcd-green hover:bg-logic-lcd-green/25`} onClick={() => setStatus(a.id, 'approved')}>
                        {a.status === 'pending' ? <><Check size={12} /> Aprovar</> : <><UserCheck size={12} /> Liberar</>}
                      </button>
                    )}
                    {a.status === 'approved' && on && (
                      <button
                        className={`${btn} text-logic-text-dim hover:text-logic-lcd-amber hover:bg-logic-lcd-amber/10`}
                        onClick={() => doDisconnect(a)}
                        title="Derruba agora. Ele continua na lista e entra de novo com usuário e senha."
                      >
                        <WifiOff size={12} /> Desconectar
                      </button>
                    )}
                    {a.status === 'approved' && (
                      <button className={`${btn} text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-lcd-red/10`} onClick={() => setStatus(a.id, 'blocked')} title="Desconecta agora e não deixa entrar até você liberar">
                        <Ban size={12} /> Bloquear
                      </button>
                    )}
                    {a.status !== 'pending' && (
                      <button className={`${btn} text-logic-text-muted hover:text-logic-lcd-amber hover:bg-logic-lcd-amber/10`} onClick={() => setConfirm({ id: a.id, what: 'reset' })} title="O músico cria uma senha nova no próximo acesso, com o PIN dos músicos">
                        <KeyRound size={12} /> Zerar senha
                      </button>
                    )}
                    <button
                      className={`${btn} text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-lcd-red/10`}
                      onClick={() => setConfirm({ id: a.id, what: 'remove' })}
                      title={a.status === 'pending' ? 'Recusar e apagar o pedido' : 'Tira da lista (com os cadernos). Para voltar, precisa do QR e do PIN dos músicos.'}
                    >
                      <Trash2 size={12} /> {a.status === 'pending' ? 'Recusar' : 'Excluir'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
