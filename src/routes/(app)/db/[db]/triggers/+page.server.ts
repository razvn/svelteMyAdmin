import { loadTriggers, triggerActions } from '#lib/server/database/triggers-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadTriggers(event);

export const actions: Actions = triggerActions();
