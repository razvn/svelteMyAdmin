import { EN_FORMAT, type LocaleFormat } from '#lib/format.ts';
import type { Translator } from './translator.ts';

/**
 * Separators and units of a language, taken from the catalog like phpMyAdmin does
 * (`__(',')` thousands, `__('.')` decimal, `__('B')`, `__('KiB')`, ...).
 */
export function localeFormat(tr: Translator): LocaleFormat {
	if (tr.locale === 'en') return EN_FORMAT;
	return {
		locale: tr.intl,
		thousands: tr.t(','),
		decimal: tr.t('.'),
		units: [
			tr.t('B'),
			tr.t('KiB'),
			tr.t('MiB'),
			tr.t('GiB'),
			tr.t('TiB'),
			tr.t('PiB'),
			tr.t('EiB')
		],
		timespan: (d, h, m, s) =>
			tr.t('{days} days, {hours} hours, {minutes} minutes and {seconds} seconds', {
				days: d,
				hours: h,
				minutes: m,
				seconds: s
			})
	};
}
