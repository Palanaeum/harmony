import { Client, DMChannel, GuildChannel, Message, PartialGroupDMChannel, Permissions, UserResolvable } from 'discord.js';
import markdown, { Capture, Parser, SingleASTNode, State } from 'simple-markdown';

const rules = {
  text: Object.assign({}, markdown.defaultRules.text, {
    match: (source: string) => /^[\s\S]+?(?=[^0-9A-Za-z\s\u00C0-\uFFFF-]|\n\n|\n|\w+:\S|$)/.exec(source)
  }),
  blockQuote: Object.assign({}, markdown.defaultRules.blockQuote, {
    match(source: string, state: State, prevSource: string): Capture | null {
      return !/^$|\n *$/.test(prevSource) || state.inQuote ? null : /^( *>>> ([\s\S]*))|^( *> [^\n]*(\n *> [^\n]*)*\n?)/.exec(source);
    },
    parse(capture: Capture, parse: Parser, state: State) {
      const all = capture[0];
      const isBlock = Boolean(/^ *>>> ?/.exec(all));
      const removeSyntaxRegex = isBlock ? /^ *>>> ?/ : /^ *> ?/gm;
      const content = all.replace(removeSyntaxRegex, '');

      state.inQuote = true;
      if (!isBlock) {
        state.inline = true;
      }

      const parsed = parse(content, state);

      state.inQuote = state.inQuote || false;
      state.inline = state.inline || false;

      return {
        content: parsed,
        type: 'blockQuote'
      };
    }
  }),
  codeBlock: Object.assign({}, markdown.defaultRules.codeBlock, {
    match: markdown.inlineRegex(/^```(([a-z0-9-]+?)\n+)?\n*([^]+?)\n*```/i),
    parse(capture: Capture, parse: Parser, state: State) {
      return {
        lang: (capture[2] || '').trim(),
        content: capture[3],
        inQuote: state.inQuote || false
      };
    }
  }),
  newline: markdown.defaultRules.newline,
  escape: markdown.defaultRules.escape,
  autolink: Object.assign({}, markdown.defaultRules.autolink, {
    parse(capture: Capture) {
      return {
        content: [
          {
            type: 'text',
            content: capture[1]
          }
        ],
        target: capture[1]
      };
    }
  }),
  url: Object.assign({}, markdown.defaultRules.url, {
    parse(capture: Capture) {
      return {
        content: [
          {
            type: 'text',
            content: capture[1]
          }
        ],
        target: capture[1]
      };
    }
  }),
  em: markdown.defaultRules.em,
  strong: markdown.defaultRules.strong,
  u: markdown.defaultRules.u,
  strike: Object.assign({}, markdown.defaultRules.del, {
    match: markdown.inlineRegex(/^~~([\s\S]+?)~~(?!_)/)
  }),
  inlineCode: markdown.defaultRules.inlineCode,
  emoticon: {
    order: markdown.defaultRules.text.order,
    match: (source: string) => /^(¯\\_\(ツ\)_\/¯)/.exec(source),
    parse(capture: Capture) {
      return {
        type: 'text',
        content: capture[1]
      };
    }
  },
  br: Object.assign({}, markdown.defaultRules.br, {
    match: markdown.anyScopeRegex(/^\n/)
  }),
  spoiler: {
    order: 0,
    match: (source: string) => /^\|\|([\s\S]+?)\|\|/.exec(source),
    parse(capture: Capture, parse: Parser, state: State) {
      return {
        content: parse(capture[1], state)
      };
    }
  }
};

const discordRules = {
  discordUser: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^<@!?([0-9]*)>/.exec(source),
    parse(capture: Capture) {
      return {
        id: capture[1]
      };
    }
  },
  discordChannel: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^<#?([0-9]*)>/.exec(source),
    parse(capture: Capture) {
      return {
        id: capture[1]
      };
    }
  },
  discordRole: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^<@&([0-9]*)>/.exec(source),
    parse(capture: Capture) {
      return {
        id: capture[1]
      };
    }
  },
  discordEmoji: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^<(a?):(\w+):(\d+)>/.exec(source),
    parse(capture: Capture) {
      return {
        animated: capture[1] === 'a',
        name: capture[2],
        id: capture[3]
      };
    }
  },
  discordEveryone: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^@everyone/.exec(source),
    parse() {
      return {};
    }
  },
  discordHere: {
    order: markdown.defaultRules.strong.order,
    match: (source: string) => /^@here/.exec(source),
    parse() {
      return {};
    }
  }
};
Object.assign(rules, discordRules);

const messageUtils = markdown.parserFor(rules);
export default function parse(source: string): Array<SingleASTNode> {
  return messageUtils(source, { inline: true });
}

export function sanitize(source: string): string {
  const parsed = parse(source);

  function sanitizeNode(node: SingleASTNode) {
    switch (node.type) {
      case 'strong':
      case 'em':
      case 'strike':
      case 'u':
      case 'link':
      case 'url':
      case 'autolink':
      case 'spoiler':
      case 'blockQuote':
        return node.content.map(sanitizeNode).join('');
      case 'discordUser':
      case 'discordChannel':
      case 'discordRole':
      case 'discordEveryone':
      case 'discordHere':
      case 'discordEmoji':
      case 'emoji':
        return ' ';
      case 'inlineCode':
      case 'codeBlock':
      case 'text':
        return node.content;
      case 'br':
        return '\n';
    }

    // eslint-disable-next-line no-console
    console.error('Could not map Discord message element', node);

    return '';
  }

  return parsed.map(sanitizeNode).join('');
}

// Discord doesn't allow escaping backticks inside a code block, so if
// we want accurate source, we can't use code blocks, have to escape it
// all instead
export function escape(content: string): string {
  return content.replaceAll('\\', '\\\\')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('~', '\\~')
    .replaceAll('>', '\\>')
    .replaceAll('<', '\\<');
}

/**
 * Regex patterns to match various Discord URL types and retrieve information from them via named
 * capture groups.
 */
export const patterns = class patterns {
  /**
   * [Docs](https://discord.com/developers/docs/reference#snowflakes)
   */
  static snowflake = '\\d{18}';

  /**
   * Matches a user or role mention.
   * 
   * Groups:
   * * `mentionId`: ID of the user or role
   */
  static mention = `<@(?:!|&)?(?<mentionId>${patterns.snowflake})>`;

  /**
   * Groups:
   * * `scheme` (optional): `http` or `https`
   * * `version` (optional): `canary` or `ptb`, if applicable
   */
  static web = '(?:(?<scheme>https?):\\/\\/)?(?:(?<version>canary|ptb)\\.)?discord\\.com';

  /**
   * Groups:
   * * `scheme`: `discord`
   */
  static protocol = 'discord:\\/\\/-';

  /**
   * @see patterns.web for web links
   * @see patterns.protocol for Discord protocol
   */
  static base = `(?:${patterns.web}|${patterns.protocol})`;

  /**
   * Groups:
   * * `guildId`: snowflake ID of the guild, or `@me` for DMs
   */
  static guild = `${patterns.base}\\/channels\\/(?<guildId>${patterns.snowflake}|@me)`;

  /**
   * Groups:
   * * `channelId`: snowflake ID of the channel
   */
  static channel = `${patterns.guild}\\/(?<channelId>${patterns.snowflake})`;

  /**
   * Groups:
   * * `messageId`: snowflake ID of the message
   */
  static message = `${patterns.channel}\\/(?<messageId>${patterns.snowflake})`;

  /**
   * Groups:
   * * `webhookId`: snowflake ID of the webhook
   * * `webhookToken` (optional): token that can be used to access the webhook via URL
   */
  static webhook = `${patterns.base}\\/api\\/webhooks\\/)?(?<webhookId>${patterns.snowflake})(?:\\/(?<webhookToken>.{68})\\/?)?`;
};

export class MessageResolveError extends TypeError {
  constructor(message: string) {
    super(message);
  }
}

export async function resolveMessageLink(client: Client, link: string, options?: {
  /**
   * Ensures that the given user has permission to access the message.
   */
  asUser: UserResolvable
}): Promise<Message> {
  const match = link?.match(patterns.message);
  if (!match) throw new TypeError('The provided link is not a message link!');

  const { channelId, messageId } = match.groups;
  const channel = await client.channels.fetch(channelId);
  if (!(channel.isText())) throw new MessageResolveError('Channel is not a text channel!');
  else if (
    (channel instanceof GuildChannel && !channel
      .permissionsFor(options.asUser)
      ?.has(Permissions.FLAGS.VIEW_CHANNEL))
    || (channel instanceof DMChannel && channel.recipient.id !== client.users.resolveId(options.asUser))
    || (channel instanceof PartialGroupDMChannel && !channel.recipients.some(r => r.username === (client.users.resolve(options.asUser)).username))
  ) throw new MessageResolveError('User does not have permission!');

  return await channel.messages.fetch(messageId);
}
