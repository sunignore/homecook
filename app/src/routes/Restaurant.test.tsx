import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Restaurant from './Restaurant';
import type { Snapshot } from '../household/contracts';

const mock = vi.hoisted(() => ({ command: vi.fn(), state: { snapshot: null as Snapshot | null, error: '', loading: false } }));
vi.mock('../household/useHousehold', () => ({ useHousehold: () => mock.state }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('../household/client', () => ({
  configured: true, command: mock.command, refresh: vi.fn(), invite: vi.fn(), join: vi.fn(),
  localDish: vi.fn(), migratePlans: vi.fn(), recoverRecipe: vi.fn(), subscribePush: vi.fn(), server: vi.fn(),
}));
const first = '55555555-5555-4555-8555-555555555555';
const second = '66666666-6666-4666-8666-666666666666';
beforeEach(() => {
  localStorage.clear(); mock.command.mockReset(); mock.command.mockResolvedValue({});
  mock.state = { error: '', loading: false, snapshot: {
    householdId: '44444444-4444-4444-8444-444444444444', role: 'wife', name: 'Kitchen', calendarReady: true, orders: [], plans: [],
    menu: [first, second].map((id, i) => ({ id, version: 1, available: true, recipe: { id, title: i ? 'Side dish' : 'Soup', servings: 2, ingredients: [], steps: [], tags: [] } })),
  } };
});
afterEach(() => { cleanup(); });
function open() { render(<MemoryRouter><Restaurant /></MemoryRouter>); }
it('submits multiple dishes with two diners and leaves chef controls out of the customer form', async () => {
  open();
  expect(screen.getByLabelText('인원')).toHaveValue(2);
  fireEvent.click(screen.getByLabelText('Soup'));
  fireEvent.click(screen.getByLabelText('Side dish'));
  fireEvent.click(screen.getByRole('button', { name: '이대로 주문하기' }));
  await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({
    action: 'submit', diners: 2, selection: [{ id: first, version: 1 }, { id: second, version: 1 }],
  }), expect.any(String)));
  expect(screen.queryByRole('button', { name: '주문 접수' })).not.toBeInTheDocument();
  await screen.findByText('주문을 보냈습니다. 셰프의 접수를 기다려주세요.');
});
it('keeps the selection after a failed submission and reuses its command ID', async () => {
  mock.command.mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce({});
  open();
  fireEvent.click(screen.getByLabelText('Soup'));
  fireEvent.click(screen.getByRole('button', { name: '이대로 주문하기' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Soup')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '이대로 주문하기' }));
  await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2));
  expect(mock.command.mock.calls[0]?.[1]).toBe(mock.command.mock.calls[1]?.[1]);
});
it('requires a chef comment before enabling whole-order rejection', async () => {
  mock.state.snapshot!.role = 'husband';
  mock.state.snapshot!.orders = [{
    id: '77777777-7777-4777-8777-777777777777', date: '2099-09-09', slot: 'dinner', diners: 2,
    items: [mock.state.snapshot!.menu[0]!.recipe], note: '', status: 'pending', version: 1,
    cancellation: false, thanks: false, events: [], created_at: '2026-09-08T00:00:00Z',
  }];
  open();
  expect(screen.getByRole('button', { name: '전체 거절' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('셰프의 의견 (거절·취소 시 필수)'), { target: { value: '오늘은 재료가 없어요' } });
  fireEvent.click(screen.getByRole('button', { name: '전체 거절' }));
  await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'reject', comment: '오늘은 재료가 없어요' }), expect.any(String)));
});
