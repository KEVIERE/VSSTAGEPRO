require('dotenv').config({ path: '.env.newproject.local' });
const https = require('https');
const { execSync } = require('child_process');

const stripeKey = process.env.STRIPE_SECRET_KEY;
const projectRef = process.env.NEW_SUPABASE_PROJECT_REF;
const supabaseToken = process.env.NEW_SUPABASE_ACCESS_TOKEN;

if (!stripeKey) {
  console.error('ERRO: STRIPE_SECRET_KEY nao encontrada no .env.newproject.local');
  process.exit(1);
}

const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/stripe-webhook`;

const events = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
];

async function callStripe(path, method, bodyParams) {
  return new Promise((resolve, reject) => {
    const postData = bodyParams ? new URLSearchParams(bodyParams).toString() : '';
    const req = https.request({
      hostname: 'api.stripe.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`Stripe API error ${res.statusCode}: ${json.error?.message || data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  console.log(`Verificando webhooks existentes no Stripe...`);
  const list = await callStripe('/v1/webhook_endpoints', 'GET');
  let endpoint = (list.data || []).find(e => e.url === webhookUrl);

  if (endpoint) {
    console.log(`Endpoint ja existe no Stripe (${endpoint.id}), mas o signing secret so vem na criacao.`);
  }

  console.log(`Criando novo endpoint de webhook para ${webhookUrl}...`);
  const params = [];
  params.push(['url', webhookUrl]);
  for (const ev of events) {
    params.push(['enabled_events[]', ev]);
  }
  params.push(['description', 'VS Stage Pro - Supabase Webhook']);

  const created = await callStripe('/v1/webhook_endpoints', 'POST', params);
  const secret = created.secret;

  if (!secret) {
    throw new Error('Nenhum secret retornado pelo Stripe na criacao do webhook.');
  }

  console.log(`Webhook criado com sucesso no Stripe (${created.id})!`);
  console.log(`Configurando STRIPE_WEBHOOK_SECRET no Supabase...`);

  const fs = require('fs');
  fs.writeFileSync('.env.whsec.local', `STRIPE_WEBHOOK_SECRET=${secret}\n`);

  try {
    execSync(`npx supabase secrets set --env-file .env.whsec.local --project-ref ${projectRef}`, {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: supabaseToken },
      stdio: 'inherit'
    });
    console.log('STRIPE_WEBHOOK_SECRET configurado com sucesso no Supabase!');
  } finally {
    if (fs.existsSync('.env.whsec.local')) {
      fs.unlinkSync('.env.whsec.local');
    }
  }
}

main().catch(err => {
  console.error('FALHA:', err.message);
  process.exit(1);
});
