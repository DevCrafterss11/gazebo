import { RadioTower } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../stores/authStore';
import styles from './PlatformPages.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login();
    navigate('/dashboard', { replace: true });
  };
  return (
    <main className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={submit}>
        <div className={styles.loginBrand}><RadioTower size={32} /><strong>MUVA</strong></div>
        <h1>进入教学平台</h1>
        <p>这是教学演示登录页。账号默认使用 admin，密码不进行真实校验。</p>
        <label>账号<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>密码<input autoComplete="current-password" type="password" value={password} placeholder="任意内容（可留空）" onChange={(event) => setPassword(event.target.value)} /></label>
        <button className={styles.primaryButton} type="submit">进入平台</button>
      </form>
    </main>
  );
}
