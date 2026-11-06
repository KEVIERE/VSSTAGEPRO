import { adminApi, type OutreachRunResult } from '@/components/admin/adminApi';

// Motor do envio em massa, rodando no navegador do admin.
//
// Por que no navegador e não no banco: o projeto não tem pg_cron, então não existe agendador
// para tocar o envio sozinho. A Edge Function faz um lote por chamada (limite de 150s de
// execução), e quem chama em sequência é esta função, enquanto a aba está aberta.
//
// O que este arquivo garante:
// - uma chamada por vez, com o mesmo runToken, até a campanha terminar;
// - pausa de verdade: o botão cancela o laço e avisa a função, que solta o lease;
// - se a aba fechar, o laço morre mas nada se perde: o histórico mostra a campanha e o botão
//   Retomar continua de onde parou, porque a fila está no banco.

export type RunProgress = {
  sent: number;
  failed: number;
  left: number;
  eta: string | null;
  done: boolean;
};

export type RunHandle = {
  /** Para o envio no próximo ponto seguro e solta o lease da campanha. */
  stop: () => Promise<void>;
  /** Resolve quando o envio termina, falha ou é parado. */
  finished: Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Roda a campanha até o fim. `onProgress` é chamado a cada lote para a barra andar.
 * Erros viram rejeição da promise, com a mensagem que a função devolveu.
 */
export function runCampaign(
  campaignId: string,
  onProgress: (p: RunProgress) => void,
): RunHandle {
  let stopped = false;
  let token: string | null = null;

  const stop = async () => {
    stopped = true;
    try {
      await adminApi.outreachPause(campaignId);
    } catch {
      // Se nem isso der certo, o lease vence sozinho em 150s e a campanha pode ser retomada.
    }
  };

  const finished = (async () => {
    let guard = 0;
    // Chama a função até a campanha acabar. Um limite de chamadas seguidas sem progresso
    // evita girar para sempre se a função responder algo inesperado (por exemplo um corpo
    // vazio por erro de rede): sem isso, a tela ficaria "enviando" indefinidamente e o
    // admin acharia que a base inteira está recebendo.
    let semProgresso = 0;
    let ultimoFeito = -1;

    while (!stopped && guard++ < 5000) {
      const res: OutreachRunResult = await adminApi.outreachRun({ campaignId, runToken: token });
      if (res.runToken) token = res.runToken;

      // already_running / run_superseded: outra aba tomou o lease desta campanha. A mensagem
      // sobe igual, mas a tela traduz para "está sendo enviada em outra aba".
      if (res.error) throw new Error(res.error);

      const feito = (res.sent ?? 0) + (res.failed ?? 0);
      const restante = res.left ?? 0;
      // Resposta que não diz nada nem terminou: conta como chamada sem progresso.
      if (!res.done && !res.canceled && feito === ultimoFeito && restante !== 0) semProgresso++;
      else semProgresso = 0;
      ultimoFeito = feito;

      if (semProgresso >= 5) throw new Error('send_stalled');

      onProgress({
        sent: res.sent ?? 0,
        failed: res.failed ?? 0,
        left: restante,
        eta: res.eta ?? null,
        done: Boolean(res.done || res.canceled),
      });

      if (res.done || res.canceled) return;
      // A função devolve antes do prazo quando o lote acaba; uma pausa curta evita
      // encadear chamadas em sequência sem necessidade.
      await wait(250);
    }
  })();

  return { stop, finished };
}

/** Quanto tempo a base leva no WhatsApp. Mesma regra de whatsappEta em _shared/outreach.ts. */
export function whatsappEtaText(total: number): string {
  const seconds = Math.max(0, total) * 3;
  if (seconds < 90) return 'menos de 2 minutos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `cerca de ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `cerca de ${hours}h${String(rest).padStart(2, '0')}` : `cerca de ${hours}h`;
}
