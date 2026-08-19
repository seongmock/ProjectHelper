// 로그인 화면. **Modal 을 쓰지 않는 유일한 오버레이**다 — Modal 은 닫을 수 있는 것을 위한
// 껍데기이고(Escape·바깥 클릭), 이 화면은 닫으면 갈 곳이 없다. 뒤에 있는 것은 서버가
// 거부한 화면이거나 아직 아무것도 못 읽은 화면이다.
//
// 만료(expired)와 부팅 차단(required)은 같은 폼이지만 다른 문장을 쓴다. "다시 로그인하면
// 하던 편집이 그대로 이어진다"는 말이 없으면 사용자는 편집이 날아갔다고 생각한다.
import { useState } from 'react';
import { LogIn, ShieldAlert } from 'lucide-react';
import { authApi } from './authApi';
import './LoginGate.css';

function LoginGate({ expired = false, onSignedIn }) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await authApi.login(name.trim(), password);
            onSignedIn(res.user);
        } catch (err) {
            // 서버는 "없는 계정"과 "틀린 비밀번호"를 구분해 주지 않는다. 화면도 그대로 옮긴다.
            setError(err.status === 429
                ? '시도가 너무 많습니다. 잠시 후 다시 시도하세요.'
                : '이름 또는 비밀번호가 올바르지 않습니다.');
            setPassword('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="login-gate" role="dialog" aria-modal="true" aria-labelledby="login-gate-title">
            <form className="login-card" onSubmit={submit}>
                <div className="login-icon" aria-hidden="true">
                    {expired ? <ShieldAlert size={28} /> : <LogIn size={28} />}
                </div>
                <h1 id="login-gate-title">{expired ? '세션이 만료되었습니다' : '로그인'}</h1>
                <p className="login-sub">
                    {expired
                        ? '다시 로그인하면 화면의 편집 내용이 그대로 이어집니다.'
                        : '이 타임라인은 계정이 있는 사람만 볼 수 있습니다.'}
                </p>

                <label className="login-field">
                    <span>이름</span>
                    <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="username"
                        data-testid="login-name"
                    />
                </label>
                <label className="login-field">
                    <span>비밀번호</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        data-testid="login-password"
                    />
                </label>

                {error && <p className="login-error" role="alert">{error}</p>}

                <button className="primary-button login-submit" type="submit" disabled={busy || !name.trim() || !password}>
                    {busy ? '확인 중…' : '로그인'}
                </button>
            </form>
        </div>
    );
}

export default LoginGate;
