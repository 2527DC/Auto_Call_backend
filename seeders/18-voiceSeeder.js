const Voice = require('../models/voice.model');
const elevenlabsService = require('../services/elevenlabsService');

const voices = [
  { name: 'Leo', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Well-rounded and clear' } },
  { name: 'Luna', category: 'Premium', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Soft and calm' } },
  { name: 'Sophie', category: 'Premium', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Helpful and guiding' } },
  { name: 'Jackson', category: 'Premium', labels: { gender: 'Male', age: 'Young', accent: 'American', description: 'Deep and confident' } },
  { name: 'Marcus', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Crisp and professional' } },
  { name: 'Oliver', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Deep and narrative' } },
  { name: 'Victor', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Raspy and mature' } },
  { name: 'Celeste', category: 'Premium', labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Expressive and melodic' } },
  { name: 'Marco', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'Italian', description: 'Smooth with Italian flair' } },
  { name: 'Isabella', category: 'Premium', labels: { gender: 'Female', age: 'Young', accent: 'English', description: 'Elegant and ladylike' } },
  { name: 'Sebastian', category: 'Premium', labels: { gender: 'Male', age: 'Young', accent: 'American', description: 'Quiet and whispery' } },
  { name: 'Joy', category: 'Premium', labels: { gender: 'Female', age: 'Child', accent: 'American', description: 'Cheerful and youthful' } },
  { name: 'Freya', category: 'Premium', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Bright and energetic' } },
  { name: 'Grace', category: 'Premium', labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Soft and articulate' } },
  { name: 'Arthur', category: 'Premium', labels: { gender: 'Male', age: 'Old', accent: 'British', description: 'Deep and authoritative' } },
  { name: 'Elena', category: 'Premium', labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Pleasant and professional' } },
  { name: 'Finn', category: 'Premium', labels: { gender: 'Male', age: 'Young', accent: 'Australian', description: 'Casual and friendly' } },
  { name: 'Henry', category: 'Premium', labels: { gender: 'Male', age: 'Old', accent: 'British', description: 'Deep and classic' } },
  { name: 'Chloe', category: 'Premium', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Sweet and gentle' } },
  { name: 'Jasper', category: 'Premium', labels: { gender: 'Male', age: 'Old', accent: 'American', description: 'Rugged and gravelly' } },
  { name: 'William', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'British', description: 'Deep and formal' } },
  { name: 'Oscar', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'Irish', description: 'Cheerful Irish accent' } },
  { name: 'Beatrice', category: 'Premium', labels: { gender: 'Female', age: 'Old', accent: 'British', description: 'Warm and pleasant' } },
  { name: 'Alastair', category: 'Premium', labels: { gender: 'Male', age: 'Middle-aged', accent: 'Transatlantic', description: 'Deep and cinematic' } },
];

const deepgramVoices = [
  { name: 'Asteria (Deepgram)', voice_id: 'aura-asteria-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-asteria.wav', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Confident and clear' } },
  { name: 'Luna (Deepgram)', voice_id: 'aura-luna-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-luna.wav', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Soft and gentle' } },
  { name: 'Stella (Deepgram)', voice_id: 'aura-stella-en', category: 'Predefined', provider: 'deepgram', preview_url: null, labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Warm and natural' } },
  { name: 'Athena (Deepgram)', voice_id: 'aura-athena-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-athena.wav', labels: { gender: 'Female', age: 'Young', accent: 'British', description: 'Polite and professional' } },
  { name: 'Hera (Deepgram)', voice_id: 'aura-hera-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-hera.wav', labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Authoritative and warm' } },
  { name: 'Orion (Deepgram)', voice_id: 'aura-orion-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-orion.wav', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Deep and professional' } },
  { name: 'Arcas (Deepgram)', voice_id: 'aura-arcas-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-arcas.wav', labels: { gender: 'Male', age: 'Young', accent: 'American', description: 'Casual and approachable' } },
  { name: 'Perseus (Deepgram)', voice_id: 'aura-perseus-en', category: 'Predefined', provider: 'deepgram', preview_url: null, labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Crisp and energetic' } },
  { name: 'Angus (Deepgram)', voice_id: 'aura-angus-en', category: 'Predefined', provider: 'deepgram', preview_url: null, labels: { gender: 'Male', age: 'Middle-aged', accent: 'Irish', description: 'Friendly and distinct' } },
  { name: 'Orpheus (Deepgram)', voice_id: 'aura-orpheus-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-orpheus.wav', labels: { gender: 'Male', age: 'Old', accent: 'American', description: 'Narrative and mature' } },
  { name: 'Helios (Deepgram)', voice_id: 'aura-helios-en', category: 'Predefined', provider: 'deepgram', preview_url: null, labels: { gender: 'Male', age: 'Young', accent: 'British', description: 'Polite and crisp' } },
  { name: 'Zeus (Deepgram)', voice_id: 'aura-zeus-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-zeus.wav', labels: { gender: 'Male', age: 'Old', accent: 'American', description: 'Deep and authoritative' } }
];

exports.up = async () => {
  try {
    const elevenLabsVoices = await elevenlabsService.fetchVoices();

    if (!elevenLabsVoices || !Array.isArray(elevenLabsVoices)) {
      throw new Error('Failed to fetch voices from ElevenLabs');
    }

    const voiceMap = new Map(elevenLabsVoices.map(v => [v.name.toLowerCase(), v]));

    const accentMapping = {
      'american': 'american',
      'english': 'british',
      'british': 'british',
      'australian': 'australian',
      'indian': 'indian',
      'african': 'african',
      'irish': 'british',
      'italian': 'american',
      'transatlantic': 'american'
    };

    for (const voice of voices) {
      let match = voiceMap.get(voice.name.toLowerCase());
      let voiceId;
      let previewUrl;

      if (!match) {
        try {
          const gender = voice.labels.gender.toLowerCase();
          const age = voice.labels.age.toLowerCase().replace('-', '_');
          const accent = accentMapping[voice.labels.accent.toLowerCase()] || 'american';

          const preview = await elevenlabsService.generateVoicePreview({
            gender,
            age,
            accent,
            text: `Hello, I am ${voice.name}, your new ${voice.labels.description} voice.`
          });

          const created = await elevenlabsService.createVoiceFromPreview({
            voice_name: voice.name,
            voice_description: voice.labels.description,
            generated_voice_id: preview.generated_voice_id,
            labels: voice.labels
          });

          voiceId = created.voice_id;
          console.log(`Successfully generated and saved voice: ${voice.name} (${voiceId})`);
        } catch (genError) {
          console.error(`Failed to generate voice "${voice.name}":`, genError.message);
          continue;
        }
      } else {
        voiceId = match.voice_id;
        previewUrl = match.preview_url;
      }

      const voiceData = {
        ...voice,
        voice_id: voiceId,
        preview_url: previewUrl,
        provider: 'elevenlabs',
        status: 'active'
      };

      await Voice.findOneAndUpdate(
        { voice_id: voiceData.voice_id },
        voiceData,
        { upsert: true, new: true }
      );
    }

    console.log('Seeding Deepgram Aura voices...');
    for (const dVoice of deepgramVoices) {
      await Voice.findOneAndUpdate(
        { voice_id: dVoice.voice_id },
        { ...dVoice, status: 'active' },
        { upsert: true, new: true }
      );
    }

    console.log('Voices seeded successfully!');
  } catch (error) {
    console.error('Error seeding voices:', error.message);
    throw error;
  }
};