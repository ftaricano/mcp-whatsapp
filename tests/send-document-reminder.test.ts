import { describe, expect, it, vi, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { handleSendDocumentReminder } from '../src/tools/send-document-reminder.js';

describe('handleSendDocumentReminder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not stat an attachment path before service path validation', async () => {
    const statSpy = vi.spyOn(fs, 'stat');
    const service = {
      sendMediaMessage: vi.fn().mockRejectedValue(new Error('File path is outside the allowed directories')),
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'msg-1',
        to_jid: '5521999999999@s.whatsapp.net',
        status: 'pending',
        timestamp: '2026-05-21T00:00:00.000Z',
      }),
    };

    const result = await handleSendDocumentReminder(service as never, {
      to: '+5521999999999',
      document_type: 'rg',
      due_date: '2026-05-22',
      attachment_path: '/private/path/outside-allowlist.pdf',
    });

    expect(service.sendMediaMessage).toHaveBeenCalledOnce();
    expect(statSpy).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      reminder_details: {
        has_attachment: false,
        attachment_failed_reason: 'File path is outside the allowed directories',
      },
    });
  });
});
