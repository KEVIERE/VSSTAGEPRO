const CODES: Record<string, string> = {
  invalid_code: 'Código ou PIN incorreto.',
  too_many_attempts: 'Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.',
  invalid_invite: 'Convite inválido. Peça um novo link ao diretor.',
  already_claimed: 'Este código já está ligado a outra conta.',
  already_member: 'Essa conta já faz parte deste show.',
  name_required: 'Informe o nome.',
  not_allowed: 'Você não tem permissão para fazer isso.',
  not_found: 'Não encontrado. Pode ter sido apagado.',
  promo_invalid: 'Código promocional inválido.',
  promo_expired: 'Este código promocional expirou.',
  promo_used_up: 'Este código promocional já atingiu o limite de usos.',
  promo_already_used: 'Você já usou este código promocional.',
  promo_exists: 'Já existe um código com esse nome.',
  promo_bad_code: 'Use de 3 a 32 letras, números, - ou _.',
  invalid_value: 'Valor inválido.',
  cannot_block_self: 'Você não pode derrubar a própria conta.',
  already_registered: 'Este e-mail já tem cadastro. Use "Entrar".',
  no_account_with_email: 'Não existe conta com esse e-mail. Crie uma conta nova.',
  email_invalid: 'Esse e-mail não é válido.',
  phone_invalid: 'Telefone inválido. Use DDD + número, por exemplo (11) 91234-5678.',
  password_short: 'A senha precisa ter pelo menos 6 caracteres.',
  password_mismatch: 'As senhas não são iguais.',
  code_invalid: 'Código incorreto. Confira e tente de novo.',
  code_expired: 'Este código expirou. Peça um novo.',
  wait_resend: 'Aguarde um minuto para pedir outro código.',
  sms_failed: 'Não foi possível enviar o SMS. Confira o número ou confirme pelo e-mail.',
  sms_not_configured: 'A confirmação por SMS ainda não está disponível. Confirme pelo e-mail.',
  sign_failed: 'Não foi possível preparar o envio do arquivo. Tente de novo.',
  invalid_build: 'Arquivo inválido. Confira o .dmg e tente de novo.',
  invalid_action: 'Ação inválida.',
  upload_failed: 'Falha ao enviar o arquivo. Confira a internet e tente de novo.',
  request_failed: 'Não foi possível concluir. Tente de novo.',
  not_authenticated: 'Sua sessão expirou. Entre de novo.',
};

const RULES: Array<[RegExp, string]> = [
  [/quota|no space|enospc|disk.?full|storage.*(full|exceed)/i,
    'O disco do Mac ficou sem espaço. Libere espaço (por exemplo, esvaziando a Lixeira) ou escolha outro disco e tente de novo.'],
  [/failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|fetch failed|timed? ?out|timeout/i,
    'Sem conexão com a internet ou o servidor não respondeu. Confira a conexão e tente de novo.'],
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/token has expired|otp.*expired|expired.*otp/i, 'Este código expirou. Peça um novo.'],
  [/token.*invalid|invalid.*(otp|token)/i, 'Código incorreto. Confira e tente de novo.'],
  [/for security purposes, you can only request this after (\d+) seconds/i, 'Aguarde alguns segundos para pedir outro código.'],
  [/email rate limit exceeded|over_email_send_rate_limit/i, 'Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.'],
  [/new password should be different/i, 'A nova senha precisa ser diferente da anterior.'],
  [/user already registered|already been registered|already exists/i, 'Este e-mail já tem cadastro. Use "Entrar".'],
  [/email not confirmed/i, 'O e-mail ainda não foi confirmado.'],
  [/password should be at least (\d+)/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/unable to validate email|invalid email|email address .* is invalid/i, 'Esse e-mail não é válido.'],
  [/jwt expired|refresh token|session.*(expired|missing)|not authenticated|auth session missing/i,
    'Sua sessão expirou. Entre de novo.'],
  [/rate limit|too many requests|429/i, 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.'],
  [/payload too large|exceeded the maximum allowed size|entity too large|413/i, 'O arquivo é grande demais para enviar.'],
  [/row-level security|permission denied|not authorized|unauthorized|forbidden|403|401/i,
    'Você não tem permissão para fazer isso.'],
  [/notallowederror|not allowed|securityerror|permission/i,
    'O Mac não deu permissão para essa ação. Confira as permissões do VS Stage e tente de novo.'],
  [/encodingerror|unable to decode|decodeaudiodata|could not decode|unsupported (audio|format)/i,
    'Não foi possível ler este áudio. Use um arquivo WAV, MP3, AIFF ou M4A que não esteja corrompido.'],
  [/notreadableerror|could not be read|not readable/i, 'Não foi possível ler o arquivo. Confira se ele não foi movido ou apagado.'],
  [/notfounderror|not found|no such file|enoent/i, 'Arquivo ou pasta não encontrado. Confira se não foi movido ou apagado.'],
  [/out of memory|allocation failed|array buffer allocation|invalid array length/i,
    'O Mac ficou sem memória para concluir. Feche outros programas e tente de novo.'],
  [/aborterror|aborted/i, 'A operação foi interrompida.'],
];

const LOOKS_ENGLISH = /\b(the|failed|error|cannot|can't|could|unable|invalid|is|are|not|of|to|was|because|would|operation|unexpected|undefined|null|object)\b/i;
const LOOKS_PORTUGUESE = /[ãõçáéíóúâêô]|\b(não|você|para|com|está|foi|uma|erro)\b/i;

/** Mensagem de erro sempre em português, sem termos técnicos. */
export function friendlyError(err: unknown, fallback = 'Não foi possível concluir. Tente de novo.'): string {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : typeof err === 'object' && err && 'message' in err
    ? String((err as { message: unknown }).message)
    : String(err ?? '');
  const message = err instanceof Error ? err.message : raw;
  if (CODES[message.trim()]) return CODES[message.trim()];
  if (message && LOOKS_PORTUGUESE.test(message)) return message;
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  if (!message || LOOKS_ENGLISH.test(message)) return fallback;
  return message;
}
