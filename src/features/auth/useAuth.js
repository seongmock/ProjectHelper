// 신원 상태 하나. 화면이 물어보는 것은 결국 "지금 로그인 창을 띄워야 하나"뿐이다.
//
// 상태는 넷이다:
//   loading  — 아직 모른다. 이 동안 화면을 가로막지 않는다(계정이 없는 배포가 기본값이다).
//   open     — 서버에 계정이 없다. 지금까지와 똑같이 동작한다.
//   authed   — 로그인돼 있다.
//   required — 인증이 필요한데 신원이 없다. **부팅 시점**에 그랬다는 뜻이다.
//   expired  — 쓰고 있던 도중 401 이 왔다(세션 만료·다른 곳에서 비밀번호 변경).
//
// required 와 expired 를 나누는 이유는 로그인 **후에 할 일**이 다르기 때문이다. 부팅 때는
// 아무것도 못 읽었으니 새로고침이 맞고, 쓰던 중이라면 화면의 편집을 날려선 안 되므로
// 새로고침하지 않고 저장을 다시 시도한다.
import { useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from './authApi';
import { setUnauthorizedHandler } from '../../utils/storage';

export function useAuth() {
    const [status, setStatus] = useState('loading');
    const [user, setUser] = useState(null);
    const statusRef = useRef(status);
    statusRef.current = status;

    const refresh = useCallback(async () => {
        try {
            const res = await authApi.me();
            setUser(res.user || null);
            if (res.user) setStatus('authed');
            else setStatus(res.mode === 'enforced' ? 'required' : 'open');
            return res;
        } catch {
            // /api/auth/me 조차 닿지 않으면 서버가 없는 것이다 — 오프라인 폴백으로 동작한다.
            setStatus('open');
            return null;
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // 데이터 요청이 401 을 받으면 그건 오프라인이 아니다(storage.js 주석 참고).
    useEffect(() => {
        setUnauthorizedHandler(() => {
            // 부팅 중 401 은 refresh() 가 required 로 정리한다. 여기서 덮으면
            // 로그인 후 새로고침이 필요한 상태를 "만료"로 잘못 부르게 된다.
            if (statusRef.current === 'open' || statusRef.current === 'authed') setStatus('expired');
        });
        return () => setUnauthorizedHandler(null);
    }, []);

    const signOut = useCallback(async () => {
        try { await authApi.logout(); } catch { /* 이미 만료됐어도 화면은 정리한다 */ }
        setUser(null);
        setStatus('required');
    }, []);

    return { status, user, refresh, signOut };
}
