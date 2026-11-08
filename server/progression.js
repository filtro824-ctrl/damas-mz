import { q } from './db.js';
import * as points from './points.js';
import * as plans from './plans.js';

const LEVEL_XP = 250;
export function forUser(userId) {
  const xp = points.balance(userId);
  const level = Math.floor(xp / LEVEL_XP) + 1;
  const general = q.get("SELECT rating,wins,losses,draws,win_streak,best_streak FROM rankings WHERE user_id=? AND category='geral'", userId)
    || { rating: 1000, wins: 0, losses: 0, draws: 0, win_streak: 0, best_streak: 0 };
  const achievements = [];
  if (general.wins >= 1) achievements.push({ id: 'first_win', name: 'Primeira vitória', description: 'Venceu a primeira partida.' });
  if (general.wins >= 10) achievements.push({ id: 'ten_wins', name: 'Dez vitórias', description: 'Alcançou 10 vitórias.' });
  if (general.best_streak >= 3) achievements.push({ id: 'streak_3', name: 'Em sequência', description: 'Venceu 3 partidas seguidas.' });
  if (xp >= 1000) achievements.push({ id: 'xp_1000', name: 'Veterano', description: 'Acumulou 1.000 XP virtual.' });
  if (general.rating >= 1500) achievements.push({ id: 'rating_1500', name: 'Elo 1500', description: 'Alcançou 1.500 pontos de classificação.' });
  if (plans.hasFeature(userId, 'special_badges')) achievements.push({ id: 'vip_badge', name: 'Emblema VIP', description: 'Subscrição VIP ativa.' });
  return {
    xp, level, xpIntoLevel: xp % LEVEL_XP, xpForNextLevel: LEVEL_XP,
    rating: general.rating, wins: general.wins, losses: general.losses, draws: general.draws,
    winStreak: general.win_streak, bestStreak: general.best_streak, achievements,
  };
}

export function detailedForUser(userId) {
  const rows = q.all(`SELECT category,COUNT(*) games,
      SUM(CASE WHEN result='d' THEN 1 ELSE 0 END) draws,
      SUM(CASE WHEN (white_id=? AND result='w') OR (black_id=? AND result='b') THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN result!='d' AND NOT ((white_id=? AND result='w') OR (black_id=? AND result='b')) THEN 1 ELSE 0 END) losses,
      COALESCE(ROUND(AVG(ply),1),0) averagePlies
    FROM games WHERE (white_id=? OR black_id=?) AND status IN ('finished','draw') GROUP BY category ORDER BY category`,
  userId, userId, userId, userId, userId, userId);
  const categories = rows.map((r) => ({ category: r.category, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, averagePlies: r.averagePlies }));
  const total = categories.reduce((a, r) => ({ games: a.games + r.games, wins: a.wins + r.wins, losses: a.losses + r.losses, draws: a.draws + r.draws }), { games: 0, wins: 0, losses: 0, draws: 0 });
  return { ...total, categories };
}
