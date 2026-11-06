import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi } from '@/components/admin/adminApi';
import type { OutreachSenderInfo } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, ErrorBox, input, Panel } from '@/components/admin/ui';

// Cartão do remetente de WhatsApp.
//
// O dono do projeto pediu para registrar o número, mas o registro não pode ser feito por
// aqui: a Meta exige login no Console Business, criação da WABA e um código que chega no
// celular do número. O que esta tela faz é o que sobra do lado de cá: mostrar o estado real
// do remetente e, quando a WABA já existir, criar o sender pela API e disparar a verificação.
//
// Até o estado ficar ONLINE, a aba não deixa disparar campanha. Explicar isso aqui é melhor
// do que deixar o envio falhar pela metade e o histórico encher de erro incompreensível.

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Rascunho: falta concluir o registro',
  CREATING: 'Criando o remetente na Twilio',
  PENDING_VERIFICATION: 'Falta confirmar o código que chegou no celular',
  VERIFYING: 'Confirmando o código',
  TWILIO_REVIEW: 'Em análise pela Twilio',
  ONLINE: 'Pronto para enviar',
  OFFLINE: 'Fora do ar',
  'ONLINE:UPDATING': 'No ar, atualizando dados',
  STUBBED: 'Cadastro incompleto',
};

export default function WhatsAppSender() {
  const [info, setInfo] = useState<OutreachSenderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('VS Stage Pro');
  const [wabaId, setWabaId] = useState('');
  const [method, setMethod] = useState<'sms' | 'voice'>('sms');
  const [code, setCode] = useState('');
  const [showRegister, setShowRegister] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await adminApi.outreachSenderStatus();
      setInfo(res);
      if (res.phone) setPhone((p) => p || res.phone!);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('register');
    setMsg(null);
    try {
      const res = await adminApi.outreachSenderRegister({ phone: phone.trim(), displayName: displayName.trim(), wabaId: wabaId.trim(), method });
      setMsg({ ok: true, text: `Remetente criado (${res.status ?? 'pendente'}). Confira o código que chegou no número.` });
      await load(true);
    } catch (err) {
      setMsg({ ok: false, text: friendlyError((err as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const sid = info?.sender?.sid;
    if (!sid) return;
    setBusy('verify');
    setMsg(null);
    try {
      await adminApi.outreachSenderVerify({ sid, code: code.replace(/\D/g, '') });
      setCode('');
      setMsg({ ok: true, text: 'Código confirmado. Se o nome de exibição ainda estiver em análise, o estado aparece abaixo.' });
      await load(true);
    } catch (err) {
      setMsg({ ok: false, text: friendlyError((err as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const status = info?.sender?.status ?? null;
  const online = Boolean(info?.online);
  const pendingCode = status === 'PENDING_VERIFICATION' || status === 'VERIFYING' || status === 'DRAFT';

  return (
    <Panel
      title="Remetente do WhatsApp"
      actions={<button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="p-4 space-y-3">
        {error && <ErrorBox text={error} />}
        {msg && (
          <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
            {msg.text}
          </div>
        )}

        {loading && !info ? (
          <div className="flex items-center gap-2 text-xs text-logic-text-muted"><Loader2 size={13} className="animate-spin" /> Consultando a Twilio…</div>
        ) : (
          <>
            <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs ${online ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40' : 'bg-logic-lcd-amber/10 border-logic-lcd-amber/40'}`}>
              {online ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-logic-lcd-green" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-logic-lcd-amber" />}
              <div className="min-w-0">
                <p className={`font-semibold ${online ? 'text-logic-lcd-green' : 'text-logic-lcd-amber'}`}>
                  {online ? 'Número liberado para envio' : 'Envio em massa bloqueado até o número ser liberado'}
                </p>
                <p className="text-logic-text-dim mt-0.5">
                  {info?.phone ? <>Número: <span className="text-logic-text">{info.phone}</span>. </> : 'Nenhum número configurado no servidor. '}
                  {status ? (STATUS_TEXT[status] ?? status) : 'Nenhum remetente encontrado no Twilio.'}
                </p>
                {info?.sender?.displayName && (
                  <p className="text-logic-text-muted mt-0.5">Nome de exibição: {info.sender.displayName}{info.sender.displayNameStatus ? ` (${info.sender.displayNameStatus})` : ''}</p>
                )}
                {info?.sender?.offlineReasons?.length ? (
                  <ul className="text-logic-text-muted mt-1 list-disc pl-4 space-y-0.5">
                    {info.sender.offlineReasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                ) : null}
              </div>
            </div>

            {pendingCode && info?.sender?.sid && (
              <form className="flex gap-1.5 items-center" onSubmit={verify}>
                <input className={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código recebido no celular" inputMode="numeric" maxLength={10} />
                <button className={btnPrimary} disabled={busy !== null || code.replace(/\D/g, '').length < 4}>
                  {busy === 'verify' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirmar
                </button>
              </form>
            )}

            {!info?.sender && !showRegister && (
              <div className="space-y-2">
                <p className="text-2xs text-logic-text-muted leading-snug">
                  Para registrar o número você precisa de um portfólio Meta Business com acesso de administrador e de uma
                  conta WhatsApp Business (WABA). Isso é feito no Console da Meta, com um código que chega no celular do
                  número. Depois disso, o cadastro na Twilio pode ser feito aqui.
                </p>
                <button type="button" className={btnGhost} onClick={() => setShowRegister(true)}>
                  <MessageCircle size={13} /> Já tenho a WABA, cadastrar o número
                </button>
              </div>
            )}

            {showRegister && (
              <form className="space-y-2" onSubmit={register}>
                <p className="text-2xs text-logic-text-muted">Preencha com os dados do Console da Meta. O código de verificação chega no celular do número, por SMS ou chamada.</p>
                <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Número com DDI, ex.: +5511985393676" required />
                <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nome de exibição, ex.: VS Stage Pro" required />
                <input className={input} value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="ID da conta WhatsApp Business (WABA)" required />
                <div className="flex items-center gap-2">
                  <div className="flex p-0.5 rounded-md bg-logic-bg-deep border border-logic-border-dark">
                    {(['sms', 'voice'] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setMethod(m)}
                        className={`px-2.5 h-7 rounded text-2xs font-semibold transition ${method === m ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}>
                        {m === 'sms' ? 'Código por SMS' : 'Código por chamada'}
                      </button>
                    ))}
                  </div>
                  <button className={btnPrimary} disabled={busy !== null || !phone.trim() || !wabaId.trim()}>
                    {busy === 'register' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Cadastrar e pedir código
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
