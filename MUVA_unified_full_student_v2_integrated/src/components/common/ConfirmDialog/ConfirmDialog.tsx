import { AlertTriangle } from 'lucide-react';

import { Modal } from '../Modal/Modal';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  cancelLabel = '取消',
}: ConfirmDialogProps) {
  return (
    <Modal title={title} description={description} onClose={onCancel} width="compact">
      <div className={styles.content}>
        <AlertTriangle size={28} aria-hidden="true" />
        <p>{description}</p>
        <div className={styles.actions}>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className={styles.confirm} type="button" onClick={() => void onConfirm()}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
