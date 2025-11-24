'use client';

import { useState } from 'react';

type MessageInputProps = {
  onSend: (message: string) => Promise<void> | void;
  disabled?: boolean;
};

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    const message = value.trim();
    setValue('');
    await onSend(message);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If Enter is pressed without Shift, send the message
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !disabled) {
        const message = value.trim();
        setValue('');
        onSend(message);
      }
    }
    // Shift+Enter will create a new line (default behavior)
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 sm:gap-3 rounded-2xl sm:rounded-3xl border border-rose-200/60 bg-[#FEEEED] p-3 sm:p-4 shadow-sm transition-shadow focus-within:border-rose-300/80 focus-within:shadow-md"
    >
      <textarea
        className="h-14 sm:h-16 flex-1 resize-none bg-transparent text-xs sm:text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
        placeholder="Ask for a breathable dress under $200 or refine a look…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-full bg-[#D61F2B] px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-[#FEEEED] shadow-lg shadow-[#D61F2B]/30 transition hover:bg-[#b91822] disabled:opacity-50 cursor-pointer"
      >
        Send
      </button>
    </form>
  );
}

