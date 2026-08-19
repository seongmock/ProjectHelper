// 계정 화면. 세 가지 상태를 한 모달이 갖는다 — 셋 다 "지금 누구인가"에 대한 답이라서
// 따로 두면 사용자가 어디를 열어야 할지 모른다.
//
//   ① 열린 모드: 계정이 없다. 여기서 첫 관리자를 만드는 것이 인증을 켜는 유일한 방법이다.
//      (환경변수 스위치를 두지 않은 이유는 server/lib/auth.js 주석에 있다.)
//   ② 로그인 상태(일반): 나는 누구인가 · 비밀번호 변경 · 로그아웃.
//   ③ 로그인 상태(관리자): 여기에 계정 목록·역할 변경·삭제가 붙는다.
import { useState, useEffect, useCallback } from 'react';
import { Trash2, ShieldCheck } from 'lucide-react';
import Modal from '../../shared/ui/Modal';
import { authApi } from './authApi';
import './AccountModal.css';

const ROLE_LABEL = { viewer: '읽기', editor: '편집', admin: '관리자' };

function AccountModal({ isOpen, onClose, status, user, onChanged, onSignOut, toast }) {
    const [users, setUsers] = useState(null);
    const [form, setForm] = useState({ name: '', password: '', role: 'editor' });
    const [newPassword, setNewPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const isAdmin = user?.role === 'admin';

    const reloadUsers = useCallback(async () => {
        if (!isAdmin) return;
        try { setUsers(await authApi.listUsers()); } catch { setUsers([]); }
    }, [isAdmin]);

    useEffect(() => { if (isOpen) reloadUsers(); }, [isOpen, reloadUsers]);

    const run = async (fn, done) => {
        if (busy) return;
        setBusy(true);
        try {
            await fn();
            if (done) toast?.success(done);
        } catch (e) {
            toast?.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    const enableAuth = () => run(async () => {
        await authApi.setup(form.name.trim(), form.password);
        setForm({ name: '', password: '', role: 'editor' });
        await onChanged();
    }, '인증을 켰습니다. 이제 계정이 있어야 편집할 수 있습니다.');

    const addUser = () => run(async () => {
        await authApi.createUser(form.name.trim(), form.password, form.role);
        setForm({ name: '', password: '', role: 'editor' });
        await reloadUsers();
    }, '계정을 만들었습니다.');

    const changeRole = (name, role) => run(async () => {
        await authApi.updateUser(name, { role });
        await reloadUsers();
    }, '역할을 바꿨습니다.');

    const removeUser = (name) => run(async () => {
        await authApi.deleteUser(name);
        await reloadUsers();
    }, '계정을 지웠습니다.');

    const changeMyPassword = () => run(async () => {
        await authApi.updateUser(user.name, { password: newPassword });
        setNewPassword('');
    }, '비밀번호를 바꿨습니다. 다른 기기의 로그인은 해제됩니다.');

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="계정" width="520px" className="account-modal">
            {status === 'open' ? (
                <>
                    <p className="account-hint">
                        지금은 <strong>누구나</strong> 이 타임라인을 읽고 편집할 수 있습니다.
                        첫 관리자를 만들면 그 순간부터 계정이 있어야 들어올 수 있습니다.
                        되돌리려면 관리자 계정을 모두 지우면 됩니다.
                    </p>
                    <div className="account-form">
                        <input
                            placeholder="관리자 이름"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            data-testid="setup-name"
                        />
                        <input
                            type="password"
                            placeholder="비밀번호 (8자 이상)"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            data-testid="setup-password"
                        />
                        <button
                            className="primary-button"
                            onClick={enableAuth}
                            disabled={busy || !form.name.trim() || form.password.length < 8}
                        >
                            <ShieldCheck size={15} aria-hidden="true" /> 인증 켜기
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <div className="account-me">
                        <div>
                            <strong>{user?.name}</strong>
                            <span className={`account-role role-${user?.role}`}>{ROLE_LABEL[user?.role] || user?.role}</span>
                        </div>
                        <button onClick={onSignOut}>로그아웃</button>
                    </div>

                    <div className="account-form">
                        <input
                            type="password"
                            placeholder="새 비밀번호 (8자 이상)"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <button onClick={changeMyPassword} disabled={busy || newPassword.length < 8}>
                            비밀번호 변경
                        </button>
                    </div>

                    {isAdmin && (
                        <>
                            <h3 className="account-section">계정</h3>
                            <ul className="account-list">
                                {(users || []).map(u => (
                                    <li key={u.name}>
                                        <span className="account-name">{u.name}</span>
                                        <select
                                            value={u.role}
                                            onChange={(e) => changeRole(u.name, e.target.value)}
                                            disabled={busy}
                                            aria-label={`${u.name} 역할`}
                                        >
                                            <option value="viewer">읽기</option>
                                            <option value="editor">편집</option>
                                            <option value="admin">관리자</option>
                                        </select>
                                        <button
                                            className="icon-button danger"
                                            onClick={() => removeUser(u.name)}
                                            disabled={busy}
                                            title={`${u.name} 삭제`}
                                        >
                                            <Trash2 size={15} aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <div className="account-form">
                                <input
                                    placeholder="새 계정 이름"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                />
                                <input
                                    type="password"
                                    placeholder="비밀번호 (8자 이상)"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                />
                                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                                    <option value="viewer">읽기</option>
                                    <option value="editor">편집</option>
                                    <option value="admin">관리자</option>
                                </select>
                                <button
                                    className="primary-button"
                                    onClick={addUser}
                                    disabled={busy || !form.name.trim() || form.password.length < 8}
                                >
                                    추가
                                </button>
                            </div>
                            <p className="account-hint">
                                읽기는 볼 수만 있고, 편집은 일정을 바꿀 수 있으며, 관리자는 계정과
                                프로젝트 삭제까지 할 수 있습니다. 마지막 관리자는 지울 수 없습니다.
                            </p>
                        </>
                    )}
                </>
            )}
        </Modal>
    );
}

export default AccountModal;
