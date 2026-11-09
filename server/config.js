// Configuração (variáveis de ambiente com valores por omissão sensatos).
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const CONFIG = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || './data',
  dbPath: process.env.DB_PATH || '',
  trustProxy: process.env.TRUST_PROXY === '1',
  secureCookie: process.env.COOKIE_SECURE === '1',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  startingPoints: num(process.env.STARTING_POINTS, 5000), // pontos DEMONSTRATIVOS
  clockMs: num(process.env.CLOCK_MINUTES, 10) * 60 * 1000, // tempo total por jogador
  startTimeoutMs: num(process.env.START_TIMEOUT_SECONDS, 180) * 1000, // ambos têm de entrar na partida
  tournamentStartMs: num(process.env.TOURNAMENT_START_TIMEOUT_MINUTES, 15) * 60 * 1000,
  reviewAfterMs: num(process.env.REVIEW_AFTER_MINUTES, 10) * 60 * 1000, // desconexão → "Em análise"
  offlineGraceMs: num(process.env.OFFLINE_GRACE_MS, 4000), // tolera recarregar a página
  queueMs: num(process.env.QUEUE_SECONDS, 60) * 1000,
  registerPerHour: num(process.env.REGISTER_LIMIT_PER_HOUR, 10), // registos por hora e por IP (antiabuso)
};

export const CATEGORIES = {
  bronze: { id: 'bronze', name: 'Bronze', entry: 100 },
  prata: { id: 'prata', name: 'Prata', entry: 250 },
  ouro: { id: 'ouro', name: 'Ouro', entry: 500 },
  diamante: { id: 'diamante', name: 'Diamante', entry: 1000 },
};
export const WAIT_OPTIONS = [20, 30];

export const ROLES = ['user', 'support', 'moderator', 'admin'];
const LEVEL = { user: 0, support: 1, moderator: 2, admin: 3 };
export const isStaff = (role) => LEVEL[role] >= 1;
export const roleAtLeast = (role, min) => (LEVEL[role] ?? 0) >= LEVEL[min];
