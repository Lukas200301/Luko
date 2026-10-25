import { RouteRegistrar, PanelError, audit, bodyOf, bool, currentUser, isSnowflake, num, str, strList } from '../context';
import { MAX_POLL_OPTIONS } from '../../utils/PollManager';
import { BirthdayInfo, PollInfo } from '../../shared/types';

// Birthdays and polls.
export const registerSocialRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  // ---- Birthdays ----

  app.get('/birthdays', async (request): Promise<BirthdayInfo[]> => {
    const guildId = str((request.query as Record<string, unknown>).guild, 30);
    return client.birthdays.list(isSnowflake(guildId) ? guildId : undefined);
  });

  app.put('/birthdays/:guildId/:userId', async (request) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    if (!isSnowflake(guildId) || !isSnowflake(userId)) throw new PanelError(400, 'Invalid server or user.');
    const body = bodyOf(request);
    const year = body.year === null || body.year === '' || body.year === undefined ? null : Math.round(num(body.year, 0));

    const guild = client.guilds.cache.get(guildId);
    const member = await guild?.members.fetch(userId).catch(() => null);
    const user = member?.user ?? await client.users.fetch(userId).catch(() => null);
    if (!user) throw new PanelError(404, 'That Discord user does not exist.');

    try {
      client.birthdays.set(guildId, userId, member?.displayName ?? user.displayName, Math.round(num(body.day, 0)), Math.round(num(body.month, 0)), year);
    } catch (error) {
      throw new PanelError(400, error instanceof Error ? error.message : String(error));
    }
    audit(ctx, request, 'Saved a birthday', `${user.username} on ${guild?.name ?? guildId}`);
    return client.birthdays.get(guildId, userId);
  });

  app.delete('/birthdays/:guildId/:userId', async (request) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    if (!client.birthdays.remove(guildId, userId)) throw new PanelError(404, 'Birthday not found.');
    audit(ctx, request, 'Removed a birthday', userId);
    return { ok: true };
  });

  // ---- Polls ----

  app.get('/polls', async (): Promise<PollInfo[]> => client.polls.list(200));

  app.post('/polls', async (request) => {
    const user = currentUser(request);
    const body = bodyOf(request);
    const channelId = str(body.channelId, 30);
    const question = str(body.question, 200);
    const options = [...new Set(strList(body.options, MAX_POLL_OPTIONS + 5).map(o => o.slice(0, 70)))];
    const minutes = num(body.durationMinutes, 0, 0, 30 * 24 * 60);

    if (!question) throw new PanelError(400, 'Enter a question.');
    if (options.length < 2 || options.length > MAX_POLL_OPTIONS) throw new PanelError(400, `A poll needs 2 to ${MAX_POLL_OPTIONS} different answers.`);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.isDMBased() || !channel.isSendable()) throw new PanelError(400, 'The bot cannot post in that channel.');

    const poll = client.polls.create({
      guildId: channel.guildId,
      channelId: channel.id,
      question,
      options,
      multiple: bool(body.multiple, false),
      anonymous: bool(body.anonymous, true),
      creatorId: user.id,
      creatorName: user.username,
      endsAt: minutes >= 1 ? Date.now() + Math.round(minutes) * 60_000 : null
    });
    const message = await channel.send(client.polls.render(poll)).catch(async (error) => {
      await client.polls.delete(poll.id);
      throw new PanelError(400, `Could not post the poll: ${error instanceof Error ? error.message : error}`);
    });
    client.polls.setMessage(poll.id, message.id);
    audit(ctx, request, 'Started a poll', `${question} in #${channel.name}`);
    return { ...client.polls.get(poll.id), url: message.url };
  });

  app.post('/polls/:id/end', async (request) => {
    const { id } = request.params as { id: string };
    if (!client.polls.get(id)) throw new PanelError(404, 'Poll not found.');
    if (!(await client.polls.end(id))) throw new PanelError(400, 'This poll has already ended.');
    audit(ctx, request, 'Ended a poll', id);
    return client.polls.get(id);
  });

  app.delete('/polls/:id', async (request) => {
    const { id } = request.params as { id: string };
    const poll = client.polls.get(id);
    if (!poll) throw new PanelError(404, 'Poll not found.');
    await client.polls.delete(id);
    audit(ctx, request, 'Deleted a poll', poll.question);
    return { ok: true };
  });
};
