// Store Discord Bot - Complete Application
// Built for Node.js (v18+) with Discord.js v14 and Express.js

// Required dependencies (install via package.json)
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

// Load environment variables (locally from .env, or from Railway settings)
dotenv.config();

// Environment variable validation
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;
const AFFILIATE_ID = process.env.AFFILIATE_ID || 'default_affiliate';

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be set in the environment variables.');
  process.exit(1);
}

// Initialize Express server for Webhooks
const app = express();
app.use(express.json());

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Database mockup (In a real scenario, use MongoDB, PostgreSQL, etc.)
// Maps Guild IDs to their designated Store Channel IDs
const storeChannels = new Map();

// Define Slash Commands
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
        .setDescription('Product Price')
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

// Register Slash Commands
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

// Bot Ready Event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await registerCommands();
  client.user.setActivity('your store operations', { type: 3 }); // ActivityType.Watching
});

// Interaction Event Handler
client.on('interactionCreate', async interaction => {
  try {
    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
      
      if (interaction.commandName === 'setup-store') {
        // Create the modal asking for the channel name
        const modal = new ModalBuilder()
          .setCustomId('setupStoreModal')
          .setTitle('Configure Store Channel');

        // Add text input for channel name
        const channelNameInput = new TextInputBuilder()
          .setCustomId('channelNameInput')
          .setLabel("What should we name the store channel?")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., premium-store')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(100);

        const firstActionRow = new ActionRowBuilder().addComponents(channelNameInput);
        modal.addComponents(firstActionRow);

        // Show the modal to the user
        await interaction.showModal(modal);
      }
      
      if (interaction.commandName === 'post-product') {
        const storeChannelId = storeChannels.get(interaction.guild.id);
        
        if (!storeChannelId) {
          return interaction.reply({ content: 'Store channel not configured yet. Please use `/setup-store` first.', ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(storeChannelId);
        if (!channel) {
           return interaction.reply({ content: 'Configured store channel was not found. Please run `/setup-store` again.', ephemeral: true });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const price = interaction.options.getString('price');
        const rawUrl = interaction.options.getString('url');
        const image = interaction.options.getString('image');

        // Append Affiliate logic to the URL
        const affiliateUrl = appendAffiliateParams(rawUrl, AFFILIATE_ID);

        // Post the product manually
        await postProductToChannel(channel, { title, description, price, url: affiliateUrl, image });
        
        await interaction.reply({ content: `Product posted successfully in <#${channel.id}>!`, ephemeral: true });
      }
    }

    // Handle Modal Submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'setupStoreModal') {
        await interaction.deferReply({ ephemeral: true });
        
        const channelName = interaction.fields.getTextInputValue('channelNameInput');

        try {
          // Format channel name (replace spaces with hyphens)
          const formattedName = channelName.toLowerCase().replace(/\s+/g, '-');

          // Create the channel with specific permissions
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
                id: client.user.id, // Ensure bot has full access
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions],
              }
            ],
          });

          // Save to our "database"
          storeChannels.set(interaction.guild.id, channel.id);

          await interaction.editReply({ content: `Store channel <#${channel.id}> created and configured successfully!` });
          
          // Send a welcome message in the new channel
          await channel.send({ content: '🛍️ **Welcome to the Store!** New products will automatically appear here.' });

        } catch (error) {
          console.error('Error creating channel:', error);
          await interaction.editReply({ content: 'Failed to create the channel. Please ensure the bot has Manage Channels permissions.' });
        }
      }
    }
  } catch (error) {
    console.error('Global Interaction Error:', error);
    // Attempt to respond if interaction is still valid and not replied to
    if (!interaction.replied && !interaction.deferred) {
        try {
             await interaction.reply({ content: 'An unexpected error occurred while executing this command.', ephemeral: true });
        } catch (e) { /* ignore secondary fail */ }
    }
  }
});

/**
 * Helper function to append affiliate tracking params to a URL
 */
function appendAffiliateParams(urlStr, affiliateId) {
  try {
    const url = new URL(urlStr);
    // Only add if not already present
    if (!url.searchParams.has('ref')) {
        url.searchParams.append('ref', affiliateId);
    }
    return url.toString();
  } catch (e) {
    // If invalid URL, return original string (or handle error)
    return urlStr;
  }
}

/**
 * Core function to format and send a product embed to a channel
 */
async function postProductToChannel(channel, productData) {
  try {
    const { title, description, price, url, image } = productData;

    // Create a highly stylized embed
    const embed = new EmbedBuilder()
      .setColor('#2ecc71') // A nice professional green
      .setTitle(`🛒 ${title}`)
      .setURL(url)
      .setDescription(description)
      .addFields(
        { name: 'Price', value: `**${price}**`, inline: true },
        { name: 'Status', value: '🟢 In Stock', inline: true }
      )
      .setFooter({ text: 'Official Store', iconURL: channel.guild.iconURL() })
      .setTimestamp();

    if (image) {
      embed.setImage(image);
    }

    // Create a Buy button
    const buyButton = new ButtonBuilder()
      .setLabel('Buy Now')
      .setURL(url)
      .setStyle(ButtonStyle.Link); // Link buttons must have a URL

    const actionRow = new ActionRowBuilder().addComponents(buyButton);

    // Send the message
    const message = await channel.send({ 
      embeds: [embed], 
      components: [actionRow] 
    });

    // Automatically react to allow users to interact
    // Since users cannot AddReactions, they can only click existing ones
    await message.react('🔥');
    await message.react('🛒');
    
    return message;
  } catch (error) {
    console.error(`Failed to post product to channel ${channel.id}:`, error);
    throw error;
  }
}

// ==========================================
// EXPRESS SERVER SETUP (Webhook Receiver)
// ==========================================

// Endpoint to receive incoming product data from your website
// Expected JSON payload: { guildId: "123", title: "Product", description: "...", price: "$10", url: "http...", image: "http..." }
app.post('/api/webhook/new-product', async (req, res) => {
  const authHeader = req.headers['authorization'];
  
  // Basic security check (use a better system in production)
  if (authHeader !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { guildId, title, description, price, url, image } = req.body;

  if (!guildId || !title || !price || !url) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Find the configured store channel for this guild
  const storeChannelId = storeChannels.get(guildId);
  
  if (!storeChannelId) {
    return res.status(404).json({ error: 'Store channel not configured for this guild. Admin must run /setup-store.' });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');

    const channel = guild.channels.cache.get(storeChannelId);
    if (!channel) throw new Error('Channel not found');

    // Append Affiliate URL logic
    const affiliateUrl = appendAffiliateParams(url, AFFILIATE_ID);

    await postProductToChannel(channel, {
        title,
        description: description || 'Check out our new product!',
        price,
        url: affiliateUrl,
        image
    });

    res.status(200).json({ success: true, message: 'Product posted successfully via webhook.' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Failed to post product to Discord.' });
  }
});

// Simple health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).send('Bot and Webhook Server are healthy.');
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

// Login the Discord Bot
client.login(DISCORD_TOKEN);
