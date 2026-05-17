const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;
const AFFILIATE_ID = process.env.AFFILIATE_ID || 'default_aff';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secure_secret_token';

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be set in the environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Mock database to store mapping of Guild IDs to Store Channel IDs
const storeChannels = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('setup-store')
    .setDescription('Creates and configures a new store channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  
  new SlashCommandBuilder()
    .setName('post-product')
    .setDescription('Manually post a product to the store channel (Admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption(option => 
      option.setName('title')
        .setDescription('Product Title')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('description')
        .setDescription('Product Description')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('price')
        .setDescription('Product Price (e.g. $19.99)')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('url')
        .setDescription('Product URL')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('image')
        .setDescription('Product Image URL')
        .setRequired(false))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await registerCommands();
  client.user.setActivity('the marketplace', { type: 3 }); // ActivityType.Watching
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-store') {
        const modal = new ModalBuilder()
          .setCustomId('setupStoreModal')
          .setTitle('Configure Store Channel');

        const channelNameInput = new TextInputBuilder()
          .setCustomId('channelNameInput')
          .setLabel("What should we name the store channel?")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., premium-shop')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(100);

        const firstActionRow = new ActionRowBuilder().addComponents(channelNameInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
      }
      
      if (interaction.commandName === 'post-product') {
        const storeChannelId = storeChannels.get(interaction.guild.id);
        if (!storeChannelId) {
          return interaction.reply({ content: '❌ Store channel not configured yet. Please use `/setup-store` first.', ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(storeChannelId);
        if (!channel) {
          return interaction.reply({ content: '❌ Configured store channel was not found. Please run `/setup-store` again.', ephemeral: true });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const price = interaction.options.getString('price');
        const rawUrl = interaction.options.getString('url');
        const image = interaction.options.getString('image');

        const affiliateUrl = appendAffiliateParams(rawUrl, AFFILIATE_ID);
        await postProductToChannel(channel, { title, description, price, url: affiliateUrl, image });
        
        await interaction.reply({ content: `✅ Product posted successfully in <#${channel.id}>!`, ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'setupStoreModal') {
        await interaction.deferReply({ ephemeral: true });
        const channelName = interaction.fields.getTextInputValue('channelNameInput');

        try {
          const formattedName = channelName.toLowerCase().replace(/\s+/g, '-');

          // Create the store channel and lock permissions so users cannot chat or add new reactions
          const channel = await interaction.guild.channels.create({
            name: formattedName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              {
                id: interaction.guild.roles.everyone.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
              },
              {
                id: client.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.AddReactions,
                  PermissionFlagsBits.ReadMessageHistory
                ],
              }
            ],
          });

          storeChannels.set(interaction.guild.id, channel.id);
          await interaction.editReply({ content: `🎉 Store channel <#${channel.id}> has been created and configured successfully!` });
          
          await channel.send({ content: '🛍️ **Welcome to our Official Store!** New products will automatically appear here. Stay tuned!' });
        } catch (error) {
          console.error('Error creating store channel:', error);
          await interaction.editReply({ content: '❌ Failed to create the channel. Ensure the bot has "Manage Channels" permission.' });
        }
      }
    }
  } catch (error) {
    console.error('Global Interaction Error:', error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true });
      } catch (e) { /* silent catch */ }
    }
  }
});

function appendAffiliateParams(urlStr, affiliateId) {
  try {
    const url = new URL(urlStr);
    if (!url.searchParams.has('ref')) {
      url.searchParams.append('ref', affiliateId);
    }
    return url.toString();
  } catch (e) {
    return urlStr;
  }
}

async function postProductToChannel(channel, productData) {
  try {
    const { title, description, price, url, image } = productData;

    const embed = new EmbedBuilder()
      .setColor('#2ecc71') // Premium green accent
      .setTitle(`🛒 ${title}`)
      .setURL(url)
      .setDescription(description)
      .addFields(
        { name: '💵 Price', value: `**${price}**`, inline: true },
        { name: '⚡ Status', value: '🟢 In Stock', inline: true }
      )
      .setFooter({ text: 'Verified Store Product', iconURL: channel.guild.iconURL() })
      .setTimestamp();

    if (image && image.startsWith('http')) {
      embed.setImage(image);
    }

    const buyButton = new ButtonBuilder()
      .setLabel('Buy Now 🛒')
      .setURL(url)
      .setStyle(ButtonStyle.Link);

    const actionRow = new ActionRowBuilder().addComponents(buyButton);

    const message = await channel.send({ 
      embeds: [embed], 
      components: [actionRow] 
    });

    // Preset reactions to allow regular users to react safely
    await message.react('🔥');
    await message.react('💖');
    
    return message;
  } catch (error) {
    console.error(`Failed to post product to channel ${channel.id}:`, error);
    throw error;
  }
}

const app = express();
app.use(express.json());

app.post('/api/webhook/new-product', async (req, res) => {
  const authHeader = req.headers['authorization'];
  
  // Basic security validation
  if (authHeader !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid credentials.' });
  }

  const { guildId, title, description, price, url, image } = req.body;

  if (!guildId || !title || !price || !url) {
    return res.status(400).json({ error: 'Missing required parameters: guildId, title, price, and url are mandatory.' });
  }

  const storeChannelId = storeChannels.get(guildId);
  if (!storeChannelId) {
    return res.status(404).json({ error: 'Store channel not configured. Server administrator must run /setup-store.' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found in bot memory.');

    const channel = guild.channels.cache.get(storeChannelId);
    if (!channel) throw new Error('Store channel not found in server.');

    const affiliateUrl = appendAffiliateParams(url, AFFILIATE_ID);

    await postProductToChannel(channel, {
      title,
      description: description || 'No description provided.',
      price,
      url: affiliateUrl,
      image
    });

    res.status(200).json({ success: true, message: 'Product posted successfully to Discord.' });
  } catch (error) {
    console.error('Webhook processing failure:', error);
    res.status(500).json({ error: `Internal error: ${error.message}` });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('Webhook API & bot engine are healthy.');
});

app.listen(PORT, () => {
  console.log(`Webhook handler server successfully started on port ${PORT}`);
});

client.login(DISCORD_TOKEN);
