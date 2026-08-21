const getAIErrorMessage = (err) => {
  const errorMessage = err.message || '';
  const lowerMessage = errorMessage.toLowerCase();
  const statusCode = err.response?.status || err.status || 500;

  if (statusCode === 402 || 
      lowerMessage.includes('depleted your monthly included credits') || 
      lowerMessage.includes('insufficient credits') || 
      lowerMessage.includes('payment required') ||
      lowerMessage.includes('winston credits are finished')
  ) {
    return lowerMessage.includes('winston credits are finished') 
      ? 'Your Winston credits are finished, please upgrade it.'
      : 'Your AI credits are finished. Please add credits to your account to continue using this feature.';
  }

  if (lowerMessage.includes('quota exceeded') || lowerMessage.includes('resource has been exhausted')) {
    return 'Gemini API quota exceeded. Please check your billing or try again later.';
  }

  if (lowerMessage.includes('api key') || lowerMessage.includes('not configured')) {
    return 'AI API key is missing or invalid. Please configure it in Settings.';
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('rate_limit_exceeded')) {
    return 'Rate limit reached for the AI service. Please wait a moment before trying again.';
  }

  if (statusCode === 413 || lowerMessage.includes('request too large') || lowerMessage.includes('tokens per minute') || lowerMessage.includes('tpm') || lowerMessage.includes('reduce your message size')) {
    return 'The content is too long for the AI to process at once. Please try with shorter text or reduce the word count.';
  }

  if (lowerMessage.includes('overloaded') || lowerMessage.includes('service unavailable') || lowerMessage.includes('503')) {
    return 'AI service is currently busy or unavailable. Please try again in a few moments.';
  }

  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('unauthenticated') || lowerMessage.includes('invalid api key') || lowerMessage.includes('user not found')) {
    return 'Authentication failed for the AI service. Please check your API keys or provider account status.';
  }

  return errorMessage.length > 0 && errorMessage.length < 150 
    ? errorMessage : 'An unexpected error occurred while processing your request.';
};

const handleAIError = (err, res, context = 'Processing request') => {
  console.error(`Error in ${context}:`, err);
  const message = getAIErrorMessage(err);
  const statusCode = err.response?.status || err.status || 500;

  const finalStatus = (message.includes('credits') || statusCode === 402) ? 402 : statusCode;
  res.status(finalStatus).json({ message });
};

module.exports = { handleAIError, getAIErrorMessage };