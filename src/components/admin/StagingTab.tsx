import { useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Play, RefreshCw, Rocket } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, Panel } from '@/components/admin/ui';

// Mesmo domínio da VPS, sem subdomínio novo — o workflow deploy-staging.yml publica
// o build mais recente da main aqui a cada push, sempre atualizado.
const STAGING_URL = 'https://vsstagepro.com.br/staging/';
// #programa força a rota do editor (em vez da página de vendas, que é o padrão sem hash
// na web pública). Só admin consegue abrir o editor completo pelo navegador — ver
// DirectorAccess.tsx — então esse link é seguro mesmo sem exigir login de novo aqui.
const STAGING_EDITOR_URL = `${STAGING_URL}#programa`;

export default function StagingTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const promote = async () => {
    if (!confirming) { setConfirming(true); return; }
    setPromoting(true);
    setMsg(null);
    try {
      await adminApi.promoteToProduction();
      setMsg({ ok: true, text: 'Upgrade disparado! Acompanhe o progresso na aba Actions do GitHub — site e app Mac são publicados em sequência, automaticamente.' });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setPromoting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Teste interno</h2>
          <p className="text-xs text-logic-text-dim max-w-2xl">
            Ambiente de testes isolado (fica em <code className="text-logic-text">/staging</code>, sem afetar quem já usa o programa).
            Toda vez que algo muda na branch principal, ele se atualiza sozinho. Teste aqui à vontade; quando estiver tudo certo,
            clique em "Upgrade de produção" para publicar o site e gerar/testar/distribuir o novo instalador do Mac para todo mundo de uma vez.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={STAGING_EDITOR_URL} target="_blank" rel="noreferrer"
            className={btnPrimary}
          >
            <Play size={13} /> Abrir o programa para teste
          </a>
          <a
            href={STAGING_URL} target="_blank" rel="noreferrer"
            className={btnGhost}
          >
            <ExternalLink size={13} /> Abrir em nova aba
          </a>
          <button type="button" className={btnGhost} onClick={() => setReloadKey((k) => k + 1)} aria-label="Recarregar preview">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
          {msg.text}
        </div>
      )}

      <Panel
        title="Upgrade de produção"
        actions={
          confirming ? (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-logic-lcd-amber font-semibold flex items-center gap-1"><AlertTriangle size={12} /> Confirma publicar pra todos agora?</span>
              <button type="button" className={btnGhost} onClick={() => setConfirming(false)} disabled={promoting}>Cancelar</button>
              <button type="button" className={btnPrimary} onClick={promote} disabled={promoting}>
                {promoting ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} Sim, publicar agora
              </button>
            </div>
          ) : (
            <button type="button" className={btnPrimary} onClick={promote} disabled={promoting}>
              <Rocket size={13} /> Upgrade de produção
            </button>
          )
        }
      >
        <p className="px-4 py-3 text-2xs text-logic-text-dim leading-relaxed">
          Isso publica o site (vsstagepro.com.br) e gera um novo instalador do Mac (arm64 + x64), testa a assinatura e a montagem,
          e distribui para a VPS e o Supabase. Quem já tem o app aberto recebe o aviso de atualização quase na hora; quem está
          fechado recebe na próxima vez que abrir com internet.
        </p>
      </Panel>

      <Panel title="Pré-visualização (/staging)" className="overflow-hidden">
        <div className="h-[70vh] bg-black">
          <iframe
            key={reloadKey}
            src={STAGING_EDITOR_URL}
            title="VS Stage Pro — Teste interno"
            className="w-full h-full border-0"
            allow="autoplay; clipboard-write"
          />
        </div>
      </Panel>
    </div>
  );
}
