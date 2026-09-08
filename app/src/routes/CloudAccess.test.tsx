import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CloudAccess from './CloudAccess';

const mock = vi.hoisted(() => ({
  status: vi.fn(),
  context: vi.fn(),
  login: vi.fn(),
  bootstrap: vi.fn(),
  setCode: vi.fn(),
  revoke: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../household/cloudAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('../household/cloudAuth')>();
  return {
    ...actual,
    cloudAuthStatus: mock.status,
    cloudAuthContext: mock.context,
    loginCloud: mock.login,
    bootstrapCloud: mock.bootstrap,
    setCloudCode: mock.setCode,
    revokeCloudSessions: mock.revoke,
    logoutCloud: mock.logout,
  };
});

beforeEach(() => {
  for (const value of Object.values(mock)) value.mockReset();
  mock.status.mockResolvedValue({ initialized: true, wifeConfigured: true });
  mock.context.mockRejectedValue(new Error('로그인이 필요합니다.'));
  mock.login.mockResolvedValue({
    householdId: '11111111-1111-4111-8111-111111111111',
    role: 'wife',
    name: '우리집 식당',
    accessVersion: 1,
  });
  mock.setCode.mockResolvedValue(undefined);
  mock.revoke.mockResolvedValue(undefined);
  mock.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('logs in as either fixed role and keeps shared-device sessions in memory', async () => {
  render(<CloudAccess />);
  await screen.findByRole('heading', { name: '로그인' });
  fireEvent.click(screen.getByLabelText('아내'));
  fireEvent.change(screen.getByLabelText(/^로그인 코드/), { target: { value: 'WifeCode2026' } });
  fireEvent.click(screen.getByLabelText(/^이 기기에 로그인 유지/));
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));
  await waitFor(() => expect(mock.login).toHaveBeenCalledWith('wife', 'WifeCode2026', false));
  expect(await screen.findByText('아내')).toBeInTheDocument();
});

it('shows the one-time bootstrap form before initialization', async () => {
  mock.status.mockResolvedValue({ initialized: false, wifeConfigured: false });
  mock.bootstrap.mockResolvedValue({
    householdId: '11111111-1111-4111-8111-111111111111',
    role: 'husband',
    name: '두 사람 식당',
    accessVersion: 1,
  });
  render(<CloudAccess />);
  await screen.findByRole('heading', { name: '처음 한 번만 설정' });
  fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '두 사람 식당' } });
  fireEvent.change(screen.getByLabelText('초기 설정 비밀값'), { target: { value: 'bootstrap-secret-value-1234' } });
  fireEvent.change(screen.getByLabelText(/^남편 로그인 코드/), { target: { value: 'HusbandCode2026' } });
  fireEvent.click(screen.getByRole('button', { name: '우리집 계정 만들기' }));
  await waitFor(() => expect(mock.bootstrap).toHaveBeenCalledWith(
    'bootstrap-secret-value-1234', '두 사람 식당', 'HusbandCode2026', true,
  ));
});

it('lets only the husband view credential administration controls', async () => {
  mock.context.mockResolvedValue({
    householdId: '11111111-1111-4111-8111-111111111111',
    role: 'husband',
    name: '우리집 식당',
    accessVersion: 1,
  });
  render(<CloudAccess />);
  await screen.findByRole('heading', { name: '로그인 코드 관리' });
  fireEvent.change(screen.getByLabelText(/^새 로그인 코드/), { target: { value: 'NewWifeCode2026' } });
  fireEvent.click(screen.getByRole('button', { name: '코드 저장' }));
  await waitFor(() => expect(mock.setCode).toHaveBeenCalledWith('wife', 'NewWifeCode2026'));
});

it('has no automated WCAG 2.1 AA violations on the login screen', async () => {
  document.documentElement.lang = 'ko';
  document.title = '우리집 계정';
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  render(<CloudAccess />);
  await screen.findByRole('heading', { name: '로그인' });
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  expect(results.violations).toEqual([]);
});
