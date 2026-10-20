import type { MessageKey } from '../i18n';
export type Workspace = 'business' | 'family' | 'alex' | 'irina';
export type Transaction = {
  id: string; workspace: Workspace; date: string; label: { en: string; ru: string };
  kind: 'payment' | 'refund' | 'part' | 'expense' | 'salary' | 'transfer';
  cents: number; source: string;
};
export const workspaceIds: Workspace[] = ['family', 'alex', 'irina', 'business'];
export const demoTransactions: Transaction[] = [
  { id: 'demo-1', workspace: 'business', date: '2026-10-19', label: { en: 'Appliance repair · #126', ru: 'Ремонт техники · #126' }, kind: 'payment', cents: 27500, source: 'CRM #126' },
  { id: 'demo-2', workspace: 'business', date: '2026-10-19', label: { en: 'Replacement part · #126', ru: 'Запчасть · #126' }, kind: 'part', cents: -6000, source: 'CRM #126' },
  { id: 'demo-3', workspace: 'business', date: '2026-10-18', label: { en: 'Customer refund · #125', ru: 'Возврат клиенту · #125' }, kind: 'refund', cents: -35000, source: 'CRM #125' },
  { id: 'demo-4', workspace: 'business', date: '2026-10-18', label: { en: 'Fuel', ru: 'Бензин' }, kind: 'expense', cents: -4500, source: 'Nestwise' },
  { id: 'demo-5', workspace: 'business', date: '2026-10-17', label: { en: 'Internet', ru: 'Интернет' }, kind: 'expense', cents: -8800, source: 'Nestwise' },
  { id: 'demo-6', workspace: 'business', date: '2026-10-16', label: { en: 'Appliance repair · #125', ru: 'Ремонт техники · #125' }, kind: 'payment', cents: 35000, source: 'CRM #125' },
  { id: 'demo-7', workspace: 'business', date: '2026-10-16', label: { en: 'Nonreturnable part · #125', ru: 'Невозвратная запчасть · #125' }, kind: 'part', cents: -9500, source: 'CRM #125' },
  { id: 'demo-8', workspace: 'business', date: '2026-10-15', label: { en: 'Tools', ru: 'Инструменты' }, kind: 'expense', cents: -2500, source: 'Nestwise' },
  { id: 'demo-f1', workspace: 'family', date: '2026-10-19', label: { en: 'Groceries', ru: 'Продукты' }, kind: 'expense', cents: -12540, source: 'Nestwise' },
  { id: 'demo-f2', workspace: 'family', date: '2026-10-16', label: { en: 'Household transfer', ru: 'Перевод на семейные расходы' }, kind: 'transfer', cents: 50000, source: 'Nestwise' },
  { id: 'demo-a1', workspace: 'alex', date: '2026-10-18', label: { en: 'Personal purchase', ru: 'Личная покупка' }, kind: 'expense', cents: -4500, source: 'Nestwise' },
  { id: 'demo-i1', workspace: 'irina', date: '2026-10-16', label: { en: 'Weekly W-2 pay', ru: 'Еженедельная зарплата W-2' }, kind: 'salary', cents: 85000, source: 'Nestwise' },
];
export const eventLabels: MessageKey[] = ['eventPayment', 'eventPart', 'eventRefund', 'eventCredit', 'eventCorrection'];
