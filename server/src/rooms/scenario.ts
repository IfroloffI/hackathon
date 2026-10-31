import { scenarioForLevel, type ScenarioBonus, type ScenarioDef, type ScenarioStep, type StepCondition } from '@chronolet/shared';

/** Факты об эпохе, по которым проверяются условия шагов. Их сообщает комната. */
export interface ScenarioFacts {
  rolesFilled: boolean;
  stagesPassed: number;
  solved: boolean;
  aboard: boolean;
}

export interface StepChange {
  from: ScenarioStep;
  to: ScenarioStep | null;
  elapsedSeconds: number;
  underPar: boolean;
}

/**
 * Исполнитель декларативного сценария эпохи (shared/src/scenarios.ts): держит текущий шаг,
 * проверяет условие завершения по фактам и переходит дальше, считая контрольное время.
 * Сам ничего не рассылает — возвращает переходы, комната превращает их в события, XP и реплики.
 */
export class ScenarioRuntime {
  readonly def: ScenarioDef | null;
  private index = 0;
  private startedAt: number;
  private talked = new Set<string>();
  /** Счётчики для бонусов эпохи. */
  falls = 0;
  hints = 0;

  constructor(levelId: string, private now: () => number = Date.now) {
    this.def = scenarioForLevel(levelId) ?? null;
    this.startedAt = now();
  }

  get step(): ScenarioStep | null {
    return this.def?.steps[this.index] ?? null;
  }

  get stepIndex() {
    return this.index;
  }

  get stepStartedAt() {
    return this.startedAt;
  }

  /** Роли открываются после брифинга (на корабле ролей нет вовсе). */
  get rolesOpen(): boolean {
    return !!this.step?.rolesOpen;
  }

  talkedTo(agent: string, facts: ScenarioFacts): StepChange[] {
    this.talked.add(agent);
    return this.update(facts);
  }

  /** Проверить условия и пройти столько шагов, сколько уже выполнено. */
  update(facts: ScenarioFacts): StepChange[] {
    const changes: StepChange[] = [];
    while (this.step && this.satisfied(this.step.done, facts)) {
      const from = this.step;
      const elapsedSeconds = (this.now() - this.startedAt) / 1000;
      this.index++;
      this.startedAt = this.now();
      changes.push({ from, to: this.step, elapsedSeconds, underPar: !!from.parSeconds && elapsedSeconds <= from.parSeconds });
    }
    return changes;
  }

  private satisfied(c: StepCondition, f: ScenarioFacts): boolean {
    switch (c.kind) {
      case 'talked':
        return this.talked.has(c.agent);
      case 'roles':
        return f.rolesFilled;
      case 'stages':
        return f.stagesPassed >= c.atLeast || f.solved;
      case 'solved':
        return f.solved;
      case 'aboard':
        return f.aboard;
    }
  }

  /** Какие бонусы эпохи заработаны (считается при эвакуации). */
  bonuses(facts: { allCoins: boolean; attempts: number }): ScenarioBonus[] {
    if (!this.def) return [];
    return this.def.bonuses.filter((b) => {
      switch (b.kind) {
        case 'allCoins':
          return facts.allCoins;
        case 'noFalls':
          return this.falls === 0;
        case 'noHints':
          return this.hints === 0;
        case 'fewAttempts':
          return facts.attempts <= 2;
      }
    });
  }
}
