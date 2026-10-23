import { EventEmitter } from 'node:events';

// Internal event bus used to push live updates to the admin panel.
// Events: 'music' (guildId: string)
export const botEvents = new EventEmitter();
botEvents.setMaxListeners(50);
