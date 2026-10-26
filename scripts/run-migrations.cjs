// Script temporário de setup — roda todas as migrations do supabase/migrations
// em ordem, direto no banco Postgres do novo projeto, uma por uma, em transação.
require('dotenv').config({ path: '.env.newproject.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ref = process.env.NEW_SUPABASE_PROJECT_REF;
const pass = process.env.NEW_SUPABASE_DB_PASSWORD;

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

async function main() {
  const client = new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: pass,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
  });
  await client.connect();
  console.log(`Conectado. ${files.length} migrations a aplicar.\n`);

  const applied = [];
  const failed = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`-> ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('OK');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('FALHOU: ' + err.message.split('\n')[0]);
      failed.push({ file, error: err.message });
      // continua tentando as próximas, mas registra a falha
    }
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Aplicadas: ${applied.length}/${files.length}`);
  if (failed.length) {
    console.log(`Falharam: ${failed.length}`);
    failed.forEach(f => console.log(`  - ${f.file}: ${f.error.split('\n')[0]}`));
  }

  await client.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('ERRO FATAL:', err.message);
  process.exit(1);
});
