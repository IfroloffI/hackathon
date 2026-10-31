import { ACHIEVEMENTS, XP, achievement, type PlayerState, type Role } from '@chronolet/shared';
import type { PlayerStats } from '../db/repositories.ts';

/** Участник с точки зрения прогрессии: синхронизируемое состояние + серверная статистика. */
export interface Member {
  sessionId: string;
  playerId: string;
  name: string;
  state: PlayerState;
  stats: PlayerStats;
}

export interface ProgressionIO {
  save(m: Member): void;
  /** Начислен опыт — личное уведомление и событие ряда. */
  xp(m: Member, amount: number, reason: string): void;
  /** Открыта ачивка — всем. */
  unlocked(m: Member, id: string): void;
}

/**
 * Геймификация: XP, уровни (shared/achievements.ts), ачивки, лайки.
 * Все правила здесь, комната только сообщает факты.
 */
export class Progression {
  constructor(private io: ProgressionIO) {}

  grant(m: Member, amount: number, reason: string) {
    if (amount <= 0) return;
    m.state.xp += amount;
    this.io.xp(m, amount, reason);
    this.io.save(m);
  }

  unlock(m: Member, id: string) {
    const a = achievement(id);
    if (!a || m.state.achievements.includes(id)) return;
    m.state.achievements.push(id);
    m.state.coins += a.coins;
    this.io.unlocked(m, id);
    this.grant(m, a.xp, `ачивка «${a.title}»`);
  }

  coin(m: Member) {
    m.stats.coinsTotal++;
    this.unlock(m, 'first_coin');
    if (m.stats.coinsTotal >= 25) this.unlock(m, 'collector');
    this.grant(m, XP.coin, 'VK Coin');
  }

  role(m: Member, role: Role) {
    m.stats[role]++;
    this.unlock(m, role);
    if (m.stats.observer > 0 && m.stats.mechanic > 0) this.unlock(m, 'both_roles');
    this.grant(m, XP.roleTaken, role === 'observer' ? 'роль Наблюдателя' : 'роль Механика');
  }

  fall(m: Member) {
    m.stats.falls++;
    if (m.stats.falls >= 5) this.unlock(m, 'stuntman');
    this.io.save(m);
  }

  like(from: Member, to: Member) {
    from.stats.likesGiven++;
    to.state.likes++;
    if (from.stats.likesGiven >= 10) this.unlock(from, 'fan');
    if (to.state.likes >= 5) this.unlock(to, 'liked');
    this.io.save(from);
    this.grant(to, XP.likeReceived, 'лайк');
  }

  bought(m: Member) {
    this.unlock(m, 'fashion');
  }
}

export { ACHIEVEMENTS };
