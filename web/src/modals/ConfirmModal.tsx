import { useState, type ReactNode } from 'react';
import { reportError } from '../lib/actions';
import { Button } from '../components/ui/Button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';

interface Props {
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmModal({ onClose, title, body, confirm, danger, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} labelledBy="confirm-title">
      <ModalHeader id="confirm-title" title={title} />
      <ModalBody>
        <div className="text-base text-text">{body}</div>
      </ModalBody>
      <ModalFooter>
        <Button variant="link" onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant={danger ? 'danger' : 'brand'} loading={busy} onClick={run} data-autofocus>
          {confirm}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
