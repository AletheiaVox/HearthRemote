import { ArrowUp, FileText, Image, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptAttachment } from "../../../shared/contracts";

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024;

interface ComposerProps {
  hostName: string;
  disabled: boolean;
  busy: boolean;
  onSend(text: string, attachments: PromptAttachment[]): Promise<void>;
  onStop(): Promise<void>;
}

export function Composer({ hostName, disabled, busy, onSend, onStop }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [sending, setSending] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
  }, [text]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setAttachmentError(undefined);
    const candidates = [...files];
    if (attachments.length + candidates.length > MAX_ATTACHMENT_COUNT) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENT_COUNT} files at once.`);
      return;
    }
    const nextBytes = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
      + candidates.reduce((sum, file) => sum + file.size, 0);
    const oversized = candidates.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setAttachmentError(`${oversized.name} is larger than 20 MB.`);
      return;
    }
    if (nextBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      setAttachmentError("Attachments are limited to 30 MB per message.");
      return;
    }
    try {
      const encoded = await Promise.all(candidates.map(fileToAttachment));
      setAttachments((current) => [...current, ...encoded]);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error));
    }
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if ((!value && attachments.length === 0) || disabled || busy || sending) return;
    const pendingAttachments = attachments;
    setText("");
    setAttachments([]);
    setAttachmentError(undefined);
    setSending(true);
    try {
      await onSend(value, pendingAttachments);
    } catch {
      setText(value);
      setAttachments(pendingAttachments);
    } finally {
      setSending(false);
    }
  };

  const inputDisabled = disabled || busy || sending;

  return (
    <div className="composer-shell">
      {attachments.length > 0 && (
        <div className="attachment-list">
          {attachments.map((attachment) => {
            const Icon = attachment.mimeType.startsWith("image/") ? Image : FileText;
            return (
              <div className="attachment-chip" key={attachment.id} title={`${attachment.name} · ${formatBytes(attachment.size)}`}>
                <Icon size={14} />
                <span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></span>
                <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter(({ id }) => id !== attachment.id))}><X size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
      {attachmentError && <div className="attachment-error">{attachmentError}</div>}
      <textarea
        ref={textarea}
        value={text}
        disabled={inputDisabled}
        placeholder={disabled ? "Switch control to this device to continue" : sending ? `Sending files to ${hostName}…` : `Message Codex on ${hostName}`}
        rows={1}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="composer-footer">
        <div className="composer-tools">
          <input
            ref={fileInput}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button className="attach-button" type="button" disabled={inputDisabled} onClick={() => fileInput.current?.click()} title="Attach files"><Paperclip size={17} /></button>
          <span>Enter for a new line · use the arrow to send</span>
        </div>
        {busy ? (
          <button className="send-button stop" type="button" onClick={() => void onStop()} aria-label="Stop"><Square size={15} fill="currentColor" /></button>
        ) : (
          <button className="send-button" type="button" disabled={inputDisabled || (!text.trim() && attachments.length === 0)} onClick={() => void send()} aria-label="Send"><ArrowUp size={19} /></button>
        )}
      </div>
    </div>
  );
}

function fileToAttachment(file: File): Promise<PromptAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`${file.name} could not be encoded.`));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataBase64: result.slice(comma + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
