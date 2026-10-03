import { CircleHelp } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import styles from './PlatformPages.module.css';

export function NotFoundPage() {
  return <div className={styles.page}><EmptyState icon={CircleHelp} title="页面不存在" description="当前地址未匹配到 MUVA 平台页面。" action={<Link to="/dashboard">返回平台总览</Link>} /></div>;
}
