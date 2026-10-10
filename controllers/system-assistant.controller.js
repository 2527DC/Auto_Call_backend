'use strict';

const { db } = require('../models');
const SystemAssistantKnowledge = db.SystemAssistantKnowledge;
const SystemAssistantConfig = db.SystemAssistantConfig;
const Setting = db.Setting;
const UserSetting = db.UserSetting;
const llmService = require('../services/llmService');

const getOrCreateConfig = async () => {
  let config = await SystemAssistantConfig.findOne();
  if (!config) {
    config = await SystemAssistantConfig.create({});
  }
  return config;
};

// Resolve API Key and Provider for Assistant
const resolveAssistantCredentials = async (config, userId) => {
  const provider = config.ai_provider || 'gemini';
  const model = config.ai_model || (provider === 'gemini' ? 'gemini-2.5-flash' : provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-haiku-20240307');

  let apiKey = config.custom_api_key;

  // Check server environment or platform settings
  if (!apiKey) {
    if (provider === 'gemini') {
      apiKey = process.env.GEMINI_API_KEY;
    } else if (provider === 'openai') {
      const setting = await Setting.findOne().select('openai_api_key').lean();
      apiKey = setting?.openai_api_key || process.env.OPENAI_API_KEY;
    } else if (provider === 'anthropic') {
      apiKey = process.env.ANTHROPIC_API_KEY;
    }
  }

  // Fall back to User's own AI settings if server has none
  if (!apiKey && userId) {
    const userSettings = await UserSetting.findOne({ user_id: userId }).lean();
    if (userSettings?.ai_api_key) {
      apiKey = userSettings.ai_api_key;
    }
  }

  return { provider, model, apiKey };
};

// 1. Get Public Config (Members)
exports.getConfig = async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    return res.status(200).json({
      success: true,
      data: {
        is_enabled: config.is_enabled,
        bot_name: config.bot_name,
        welcome_message: config.welcome_message,
        suggested_prompts: config.suggested_prompts
      }
    });
  } catch (error) {
    console.error('[SystemAssistant] getConfig error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assistant configuration.' });
  }
};

// 2. Chat with Assistant
exports.chat = async (req, res) => {
  try {
    const { message, conversation_history = [], current_path = '' } = req.body;
    const userId = req.user?.id || req.user?._id;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const config = await getOrCreateConfig();
    if (!config.is_enabled) {
      return res.status(403).json({ success: false, message: 'The AI Assistant is currently disabled by administrator.' });
    }

    const { provider, model, apiKey } = await resolveAssistantCredentials(config, userId);

    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: `AI provider (${provider}) is not configured. Please contact the administrator to set up an API key.`
      });
    }

    // Fetch active knowledge articles
    const activeArticles = await SystemAssistantKnowledge.find({ is_active: true })
      .sort({ order: 1, created_at: -1 })
      .lean();

    // Prioritize articles matching the current route
    let prioritizedArticles = [];
    let otherArticles = [];

    activeArticles.forEach(article => {
      const matchesRoute = (article.route_match || []).some(route => {
        if (!route) return false;
        if (route.endsWith('/*')) {
          const base = route.slice(0, -2);
          return current_path.startsWith(base);
        }
        return current_path === route || current_path.startsWith(`${route}/`);
      });

      if (matchesRoute) {
        prioritizedArticles.push(article);
      } else {
        otherArticles.push(article);
      }
    });

    const assembledArticles = [...prioritizedArticles, ...otherArticles];

    // Build context string from articles
    let knowledgeContext = '';
    if (assembledArticles.length === 0) {
      knowledgeContext = 'No system knowledge articles have been added yet by the administrator.';
    } else {
      knowledgeContext = assembledArticles.map(art => {
        return `### Document: ${art.title}\nCategory: ${art.category}\nContent:\n${art.content}\n`;
      }).join('\n---\n');
    }

    const fullSystemPrompt = `${config.system_prompt || 'You are the official Voxeno AI Assistant.'}

CURRENT USER CONTEXT:
- Active Route: "${current_path || 'Dashboard'}"

OFFICIAL SYSTEM KNOWLEDGE BASE:
${knowledgeContext}

STRICT GROUNDING INSTRUCTIONS:
1. Use the official system knowledge base above to answer the user's question accurately.
2. If the user asks about workflow nodes, guide them with step-by-step instructions on what the node does, its fields, and how to connect it.
3. If the knowledge base is empty or does not contain the answer, politely let the user know: "This topic is not yet covered in the system documentation. Please reach out to your administrator or check the Support Center." Do NOT invent fake URLs or internal system details.
4. Format your response cleanly using Markdown (use bold headings, numbered steps, code blocks, and bullet points where helpful).`;

    // Prepare message history (last 10 messages max)
    const formattedHistory = [];
    if (Array.isArray(conversation_history)) {
      conversation_history.slice(-10).forEach(msg => {
        if (msg.role && msg.content) {
          formattedHistory.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content)
          });
        }
      });
    }

    // Append latest user message
    formattedHistory.push({
      role: 'user',
      content: message.trim()
    });

    const reply = await llmService.generateChatAssistantResponse({
      messages: formattedHistory,
      systemPrompt: fullSystemPrompt,
      provider,
      model,
      apiKey,
      temperature: config.temperature || 0.2,
      maxTokens: 1500
    });

    const matchedSources = assembledArticles.slice(0, 3).map(a => a.title);

    return res.status(200).json({
      success: true,
      data: {
        reply,
        sources: assembledArticles.length > 0 ? matchedSources : []
      }
    });
  } catch (error) {
    console.error('[SystemAssistant] Chat error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate assistant response.'
    });
  }
};

// 3. Admin: Get Full Config
exports.getAdminConfig = async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    return res.status(200).json({
      success: true,
      data: {
        ...config.toObject(),
        custom_api_key_set: Boolean(config.custom_api_key),
        custom_api_key: config.custom_api_key ? '••••••••' : ''
      }
    });
  } catch (error) {
    console.error('[SystemAssistant] getAdminConfig error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin config.' });
  }
};

// 4. Admin: Update Config
exports.updateAdminConfig = async (req, res) => {
  try {
    const {
      is_enabled,
      bot_name,
      welcome_message,
      ai_provider,
      ai_model,
      custom_api_key,
      temperature,
      system_prompt,
      suggested_prompts
    } = req.body;

    const config = await getOrCreateConfig();

    if (is_enabled !== undefined) config.is_enabled = Boolean(is_enabled);
    if (bot_name !== undefined) config.bot_name = String(bot_name).trim();
    if (welcome_message !== undefined) config.welcome_message = String(welcome_message).trim();
    if (ai_provider !== undefined) config.ai_provider = ai_provider;
    if (ai_model !== undefined) config.ai_model = String(ai_model).trim();
    if (temperature !== undefined) config.temperature = Number(temperature);
    if (system_prompt !== undefined) config.system_prompt = String(system_prompt);
    if (Array.isArray(suggested_prompts)) config.suggested_prompts = suggested_prompts;

    if (custom_api_key !== undefined && custom_api_key !== '••••••••') {
      config.custom_api_key = custom_api_key ? String(custom_api_key).trim() : null;
    }

    config.updated_by = req.user?.id || req.user?._id;
    await config.save();

    return res.status(200).json({
      success: true,
      message: 'Assistant configuration updated successfully.',
      data: {
        ...config.toObject(),
        custom_api_key_set: Boolean(config.custom_api_key),
        custom_api_key: config.custom_api_key ? '••••••••' : ''
      }
    });
  } catch (error) {
    console.error('[SystemAssistant] updateAdminConfig error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update assistant config.' });
  }
};

// 5. Admin: List Knowledge Articles
exports.getKnowledgeList = async (req, res) => {
  try {
    const { search = '', category = 'all', page = 1, limit = 20, is_active } = req.query;

    const query = {};
    if (search.trim()) {
      query.$or = [
        { title: { $regex: search.trim(), $options: 'i' } },
        { content: { $regex: search.trim(), $options: 'i' } },
        { tags: { $in: [new RegExp(search.trim(), 'i')] } }
      ];
    }

    if (category && category !== 'all') {
      query.category = category;
    }

    if (is_active !== undefined && is_active !== 'all') {
      query.is_active = is_active === 'true' || is_active === true;
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const total = await SystemAssistantKnowledge.countDocuments(query);
    const articles = await SystemAssistantKnowledge.find(query)
      .sort({ order: 1, created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('created_by', 'name email');

    return res.status(200).json({
      success: true,
      data: {
        articles,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[SystemAssistant] getKnowledgeList error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch knowledge articles.' });
  }
};

// 6. Admin: Get Knowledge Article by ID
exports.getKnowledgeById = async (req, res) => {
  try {
    const { id } = req.params;
    const article = await SystemAssistantKnowledge.findById(id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Knowledge article not found.' });
    }
    return res.status(200).json({ success: true, data: article });
  } catch (error) {
    console.error('[SystemAssistant] getKnowledgeById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch knowledge article.' });
  }
};

// 7. Admin: Create Knowledge Article
exports.createKnowledge = async (req, res) => {
  try {
    const { title, category, route_match, content, tags, order, is_active } = req.body;
    const userId = req.user?.id || req.user?._id;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Content is required.' });
    }

    const article = await SystemAssistantKnowledge.create({
      title: title.trim(),
      category: category || 'general',
      route_match: Array.isArray(route_match) ? route_match : (route_match ? [route_match] : []),
      content: content.trim(),
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
      order: Number(order) || 0,
      is_active: is_active !== undefined ? Boolean(is_active) : true,
      created_by: userId
    });

    return res.status(201).json({
      success: true,
      message: 'Knowledge article created successfully.',
      data: article
    });
  } catch (error) {
    console.error('[SystemAssistant] createKnowledge error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create knowledge article.' });
  }
};

// 8. Admin: Update Knowledge Article
exports.updateKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, route_match, content, tags, order, is_active } = req.body;

    const article = await SystemAssistantKnowledge.findById(id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Knowledge article not found.' });
    }

    if (title !== undefined) article.title = title.trim();
    if (category !== undefined) article.category = category;
    if (route_match !== undefined) article.route_match = Array.isArray(route_match) ? route_match : [route_match];
    if (content !== undefined) article.content = content.trim();
    if (tags !== undefined) article.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    if (order !== undefined) article.order = Number(order);
    if (is_active !== undefined) article.is_active = Boolean(is_active);

    await article.save();

    return res.status(200).json({
      success: true,
      message: 'Knowledge article updated successfully.',
      data: article
    });
  } catch (error) {
    console.error('[SystemAssistant] updateKnowledge error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update knowledge article.' });
  }
};

// 9. Admin: Delete Knowledge Article
exports.deleteKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    const article = await SystemAssistantKnowledge.findByIdAndDelete(id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Knowledge article not found.' });
    }
    return res.status(200).json({ success: true, message: 'Knowledge article deleted successfully.' });
  } catch (error) {
    console.error('[SystemAssistant] deleteKnowledge error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete knowledge article.' });
  }
};

// 10. Admin: Bulk Delete Knowledge Articles
exports.bulkDeleteKnowledge = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of article IDs is required.' });
    }

    await SystemAssistantKnowledge.deleteMany({ _id: { $in: ids } });
    return res.status(200).json({ success: true, message: 'Selected articles deleted successfully.' });
  } catch (error) {
    console.error('[SystemAssistant] bulkDeleteKnowledge error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk delete knowledge articles.' });
  }
};
