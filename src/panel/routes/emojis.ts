import { ApplicationEmoji, Client } from 'discord.js';
import { RouteRegistrar, PanelError, audit, bodyOf, str } from '../context';
import { EmojiInfo } from '../../shared/types';

const MAX_EMOJI_BYTES = 256 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9_]{2,32}$/;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|gif|webp|avif);base64,([A-Za-z0-9+/=]+)$/;

function toInfo(emoji: ApplicationEmoji): EmojiInfo {
  return {
    id: emoji.id,
    name: emoji.name ?? 'emoji',
    animated: !!emoji.animated,
    url: emoji.imageURL({ size: 128 }),
    display: emoji.toString()
  };
}

function requireApplication(client: Client) {
  if (!client.isReady() || !client.application) {
    throw new PanelError(503, 'The bot is not connected to Discord right now.');
  }
  return client.application;
}

// Application emojis belong to the bot itself (Developer Portal → Emojis) and can be
// used by the bot in every server, which makes them ideal for the pinboard display.
export const registerEmojiRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/emojis', async (): Promise<EmojiInfo[]> => {
    const application = requireApplication(client);
    const emojis = await application.emojis.fetch();
    return emojis.map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post('/emojis', async (request): Promise<EmojiInfo> => {
    const application = requireApplication(client);
    const body = bodyOf(request);
    const name = str(body.name, 32);
    const image = typeof body.image === 'string' ? body.image : '';

    if (!NAME_PATTERN.test(name)) {
      throw new PanelError(400, 'Emoji names must be 2–32 characters: letters, numbers and underscores only.');
    }

    const match = DATA_URL_PATTERN.exec(image);
    if (!match) {
      throw new PanelError(400, 'Upload a PNG, JPEG, GIF, WebP or AVIF image.');
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_EMOJI_BYTES) {
      throw new PanelError(400, `The image is ${Math.round(buffer.length / 1024)} KB. Emojis can be at most 256 KB.`);
    }

    try {
      const emoji = await application.emojis.create({ attachment: buffer, name });
      audit(ctx, request, 'Uploaded bot emoji', `:${name}:`);
      return toInfo(emoji);
    } catch (error) {
      throw new PanelError(400, `Discord rejected the emoji: ${error instanceof Error ? error.message : error}`);
    }
  });

  app.put('/emojis/:id', async (request): Promise<EmojiInfo> => {
    const application = requireApplication(client);
    const { id } = request.params as { id: string };
    const name = str(bodyOf(request).name, 32);

    if (!NAME_PATTERN.test(name)) {
      throw new PanelError(400, 'Emoji names must be 2–32 characters: letters, numbers and underscores only.');
    }

    const emoji = await application.emojis.edit(id, { name });
    audit(ctx, request, 'Renamed bot emoji', `:${name}:`);
    return toInfo(emoji);
  });

  app.delete('/emojis/:id', async (request) => {
    const application = requireApplication(client);
    const { id } = request.params as { id: string };

    const emoji = await application.emojis.fetch(id).catch(() => null);
    if (!emoji) throw new PanelError(404, 'Emoji not found.');

    await application.emojis.delete(id);
    audit(ctx, request, 'Deleted bot emoji', `:${emoji.name}:`);
    return { ok: true };
  });
};
