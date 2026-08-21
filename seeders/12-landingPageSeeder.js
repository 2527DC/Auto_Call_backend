const LandingPage = require('../models/landing-page.model');

async function up({ db: dbModels }) {
  try {
    const LandingPageModel = dbModels.LandingPage || LandingPage;

    const seedData = {
      hero: {
        badge: 'New: Voice Calling AI v2.0',
        heading: 'AI Voice Agents That Call, Qualify, Book & Follow Up',
        subheading: 'Handle incoming calls, run outbound campaigns, collect customer information, and automate follow-ups from a single platform',
        cta_primary_text: "Let's Talk",
        cta_secondary_text: 'View Documentation',
        cta_secondary_link: 'https://docs.pixelstrap.net/autocall',
        image: null,
      },

      primary_features: {
        badge: "Platform Core",
        title: "Turn Conversations Into Customers",
        subtitle: "Transform customer communication with intelligent voice agents, automated workflows, and seamless business integrations.",
        left_card: {
          title: "Human-Like Voice Conversations",
          description: "Engage callers instantly with AI voice assistents that answer questions, collect details, and move customers through your workflow."
        },
        cards: [
          { key: 'builder', title: 'Visual Workflow Automation', description: 'Create powerful automation flows with drag-and-drop actions, conditions, webhooks, and AI-driven decision making.', image: null },
          { key: 'campaigns', title: 'Outbound Call Campaigns', description: 'Upload contacts, schedule campaigns, and let AI agents call hundreds of prospects automatically while handling conversations in real time.', image: null },
          { key: 'sync', title: 'Knowledge & Prompt Library', description: 'Train ai assistents using documents, FAQs, websites, and reusable prompts to deliver accurate and consistent responses across every call.', image: null },
          { key: 'toolbox', title: 'Developer Toolbox', description: 'Flexible REST APIs, real-time WebSockets, and custom Webhook subscriptions for seamless integration.', image: null }
        ]
      },

      comparison: {
        heading: "Turn Every Call Into an Opportunity with AI",
        robotImage: null,
        features: [
          "Available 24/7 without breaks",
          "Handle inbound and outbound calls with AI agents",
          "Collect customer information using AI-powered forms",
          "Reduce costs and increase productivity",
          "Scale your outreach globally",
          "Build powerful automations without coding"
        ],
        traditional: [
          "High operational costs",
          "Limited agent availability",
          "Limited working hours",
          "Longer response times",
          "Disconnected business workflows",
          "Inconsistent quality",
          "Difficult to scale efficiently",
        ],
        aiAgents: [
          "Lower cost per interaction",
          "Always-on AI voice agents",
          "24/7 customer engagement",
          "Instant response and follow-ups",
          "Unified automation workflows",
          "Consistent customer experiences",
          "Scale conversations on demand",
        ]
      },

      how_it_works: {
        heading: "How AutoCall Works",
        subtitle: "A seamless journey from setup to results, designed for your growth.",
        steps: [
          {
            number: 1,
            title: "Create Your AI Agent",
            description: "Configure agent's personality, goals, and conversation flow in minutes.",
            icon: "UserPlus"
          },
          {
            number: 2,
            title: "Upload & Train",
            description: "Upload documents, FAQs, websites or knowledge base to train your agent.",
            icon: "FileText"
          },
          {
            number: 3,
            title: "Launch Campaign",
            description: "Upload your leads and start AI-powered outbound calling campaigns.",
            icon: "Megaphone"
          }
        ]
      },

      automate: {
        heading: "Automate Customer Engagement at Scale",
        cards: [
          {
            title: "Automated Outgoing Calls",
            description: "Schedule and launch AI-powered outgoing call campaigns to hundreds of contacts automatically.",
            icon: "Phone"
          },
          {
            title: "24/7 AI Voice Support",
            description: "Offer round-the-clock voice assistance through an embedded AI call widget that responds instantly to customer inquiries.",
            icon: "UserCheck"
          },
          {
            title: "Appointment Automation",
            description: "Let AI agents qualify prospects and schedule appointments in real time during outbound calls.",
            icon: "Calendar"
          },
          {
            title: "WhatsApp Embedded Signup",
            description: "Seamlessly connect your WhatsApp Business account, manage templates, and automate customer follow-ups after calls.",
            icon: "Headset"
          },
          {
            title: "Smart Data Collection",
            description: "Create custom forms and let AI agents automatically collect responses during voice conversations, eliminating manual data entry.",
            icon: "RefreshCw"
          },
          {
            title: "AI Prompt Templates",
            description: "Choose from pre-built prompt templates or create your own to customize how AI agents handle calls and conversations.",
            icon: "Star"
          }
        ]
      },

      addons: {
        badge: "Add-ons",
        title: "Powerful Add-ons for Your Business",
        subtitle: "Extend your platform capabilities with seamless integrations, advanced communication channels, and scalable management tools.",
        cards: [
          {
            title: "SMS Management",
            description: "Send automated SMS notifications, appointment reminders, and follow-ups. Build unified conversational flows across voice and text.",
            image: null
          },
          {
            title: "API Integration",
            description: "Connect your existing CRM, marketing tools, and databases with our powerful REST API and Webhooks.",
            image: null
          },
          {
            title: "Teams Management",
            description: "Manage multiple teams, assign roles, and control access permissions across your entire organization with ease.",
            image: null,
            badges: ["Role-Based Access", "Add / Remove Members", "Admin Overview"]
          }
        ]
      },

      human_transfer: {
        badge: "Human Transfer",
        title: "Smart conversations.",
        subtitle: "Seamless human connection.",
        description: "Enable human transfer in your AI agents and let important conversations flow to the right team member—instantly.",
        image: null,
        features: [
          {
            title: "Keyword or intent based transfer",
            description: "Set custom keywords that automatically trigger transfer to a human."
          },
          {
            title: "Route to the right person",
            description: "Assign team members or roles while creating your agent for accurate routing."
          },
          {
            title: "Better experience, higher trust",
            description: "Handle complex queries with a human touch when it matters most."
          }
        ],
        bottom_features: [
          {
            title: "Enable in Agent Settings",
            description: "Turn on human transfer while creating incoming or outgoing agents."
          },
          {
            title: "Assign Team Members",
            description: "Choose specific members or roles to handle transferred chats."
          },
          {
            title: "Real-time Handoff",
            description: "Seamless transfer with full conversation history."
          },
          {
            title: "Track & Optimize",
            description: "Monitor transfer performance and improve customer outcomes."
          }
        ]
      },

      pricing: {
        badge: 'Pricing Plans',
        title: 'Choose the Right Plan',
        description: 'Flexible plans designed to help you automate conversations and scale faster.',
        plan_ids: [],
      },

      blog: {
        badge: 'News & Insights',
        title: 'Insights for Smarter Customer Engagement',
        description: 'Discover actionable tips, implementation guides, and AI voice use cases from real-world businesses.',
        blog_ids: [],
      },

      testimonials: {
        section_badge: 'Customer Stories',
        section_heading: 'See What Our Customers Think',
        section_subheading: 'Discover how organizations are using AI voice agents to work smarter and grow faster.',
        testimonial_ids: [],
      },

      faq: {
        section_badge: 'Questions and Answers',
        section_heading: 'Frequently asked questions',
        section_subheading: "Everything you need to know about Autocall. Can't find the answer? Contact our team.",
        faq_ids: [],
      },

      contact: {
        section_badge: "We're Online",
        heading: "Let's build something incredible together",
        subheading: 'Have specific volume requirements or custom integration plans? Reach out and our engineering support team will respond in a few hours.',
        email: 'support@autocall.com',
        phone: null,
        address: null,
        live_chat_label: 'Available 24/7',
      },

      footer: {
        tagline: 'AutoCall is a unified platform for AI voice assistents, customer engagement, workflow automation, and business communication.',
        copyright: `© ${new Date().getFullYear()} Autocall. All Rights Reserved.`,
        address: null,
        phone: null,
        email: 'support@autocall.com',
        social_links: [
          { name: 'Facebook', href: '#', icon: 'Facebook' },
          { name: 'Twitter', href: '#', icon: 'Twitter' },
          { name: 'Instagram', href: '#', icon: 'Instagram' },
          { name: 'LinkedIn', href: '#', icon: 'Linkedin' },
        ],
      },
    };

    const existingPage = await LandingPageModel.findOne({});
    if (!existingPage) {
      await new LandingPageModel(seedData).save();
      console.log('Landing page seeded successfully with empty reference arrays!');
    } else {
      let isModified = false;
      for (const key in seedData) {
        if (existingPage[key] === undefined) {
          existingPage[key] = seedData[key];
          isModified = true;
        }
      }
      if (isModified) {
        await existingPage.save();
      }
    }
  } catch (error) {
    console.error('Error seeding landing page:', error);
    throw error;
  }
}

async function down({ db: dbModels }) {
  try {
    const LandingPageModel = dbModels.LandingPage || LandingPage;
    await LandingPageModel.deleteMany({});
    console.log('Landing page seed removed successfully!');
  } catch (error) {
    console.error('Error removing landing page seed:', error);
    throw error;
  }
}

module.exports = { up, down };
