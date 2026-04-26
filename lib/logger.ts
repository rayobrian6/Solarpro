/**
 * Lightweight logger that suppresses debug/verbose output in production.
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.debug('tag', 'message', optionalData);  // silenced in production
 *   logger.info('tag', 'message');                   // always shown
 *   logger.warn('tag', 'message');                   // always shown
 *   logger.error('tag', 'message', error);           // always shown
 * 
 * Gradually replace raw console.log calls with logger.debug to suppress
 * noisy output in production without losing visibility in development.
 */

const isProd = process.env.NODE_ENV === 'production';

function formatTag(tag: string): string {
  return `[${tag}]`;
}

export const logger = {
  /** Debug-level: silenced in production */
  debug(tag: string, msg: string, data?: any) {
    if (isProd) return;
    if (data !== undefined) console.log(formatTag(tag), msg, data);
    else console.log(formatTag(tag), msg);
  },

  /** Info-level: always shown */
  info(tag: string, msg: string, data?: any) {
    if (data !== undefined) console.log(formatTag(tag), msg, data);
    else console.log(formatTag(tag), msg);
  },

  /** Warning-level: always shown */
  warn(tag: string, msg: string, data?: any) {
    if (data !== undefined) console.warn(formatTag(tag), msg, data);
    else console.warn(formatTag(tag), msg);
  },

  /** Error-level: always shown */
  error(tag: string, msg: string, data?: any) {
    if (data !== undefined) console.error(formatTag(tag), msg, data);
    else console.error(formatTag(tag), msg);
  },
};