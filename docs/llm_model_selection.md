# LLM Model Selection Strategy

This document outlines the model selection strategy for different purposes in the Velou Shopping Assistant.

## Available Models

Based on the OpenAI API, the following models are available:

### Latest Generation Models
- **gpt-5**: Latest generation, best overall performance for complex tasks
- **gpt-5-mini**: Lightweight version of GPT-5
- **gpt-5-pro**: Premium version with enhanced capabilities
- **gpt-5-nano**: Ultra-lightweight version

### GPT-4.1 Series
- **gpt-4.1**: Improved GPT-4 variant, excellent for structured outputs and reasoning
- **gpt-4.1-mini**: Lightweight version, cost-effective for simple tasks
- **gpt-4.1-nano**: Ultra-lightweight version

### Reasoning Models
- **o3-mini**: Specialized reasoning model, best for complex logical tasks
- **o3**: Full reasoning model
- **o3-pro**: Premium reasoning model
- **o1**: Original reasoning model
- **o1-pro**: Premium original reasoning model

### GPT-4o Series
- **gpt-4o**: Multimodal, fast, good balance of performance and speed
- **gpt-4o-mini**: Lightweight version, cost-effective

## Model Selection by Purpose

### 1. Intent Parsing (`intent`)

**Purpose**: Extract user shopping intent and constraints from natural language queries. Requires structured JSON output and complex reasoning.

**Selected Model**: `o3-mini` (reasoning model)
- **Why**: Intent parsing requires logical analysis of user queries, understanding context, and extracting structured constraints. Reasoning models excel at this.
- **Fallback**: `gpt-5` if reasoning model unavailable
- **Temperature**: 0.1 (low for consistent, structured outputs)

**Example Use Cases**:
- "I need a durable backpack for travel"
- "Show me skincare products for sensitive skin under $50"

### 2. Final Reply Generation (`final_reply`)

**Purpose**: Generate natural, conversational responses to user queries. Requires high-quality natural language generation.

**Selected Model**: `gpt-5`
- **Why**: GPT-5 provides the best quality for natural language generation, with improved coherence and naturalness.
- **Fallback**: `gpt-4.1` if GPT-5 unavailable
- **Temperature**: 0.7 (higher for varied, natural responses)

**Example Use Cases**:
- "Here are some great options for your travel backpack..."
- "Based on your preferences, I found these skincare products..."

### 3. PDP Suitability Analysis (`pdp_suitability`)

**Purpose**: Analyze whether a specific product matches user needs. Requires complex reasoning about product attributes and user requirements.

**Selected Model**: `o3-mini` (reasoning model)
- **Why**: Suitability analysis requires logical reasoning about product fit, attribute matching, and user preferences. Reasoning models excel at this.
- **Fallback**: `gpt-5` if reasoning model unavailable
- **Temperature**: 0.4 (moderate for balanced reasoning)

**Example Use Cases**:
- "Is this backpack suitable for a 2-week trip?"
- "Will this skincare product work for my sensitive skin?"

### 4. Card Reason Generation (`card_reason`)

**Purpose**: Generate short, concise explanations for why a product was recommended. Lightweight task, cost-sensitive.

**Selected Model**: `gpt-4.1-mini`
- **Why**: Cost-effective while maintaining quality. Card reasons are short and don't require complex reasoning.
- **Fallback**: `gpt-4o-mini` if GPT-4.1-mini unavailable
- **Temperature**: 0.55 (moderate for concise explanations)

**Example Use Cases**:
- "Chosen because it's durable and lightweight"
- "Perfect for sensitive skin with natural ingredients"

### 5. Dataset Context Inference

**Purpose**: Analyze uploaded catalog data to infer vertical, facets, and quality notes. Requires structured analysis and JSON output.

**Selected Model**: `gpt-5`
- **Why**: Dataset analysis requires understanding patterns, extracting structured information, and generating insights. GPT-5 provides best overall performance.
- **Fallback**: `gpt-4.1` if GPT-5 unavailable
- **Temperature**: 0.1 (low for consistent, structured outputs)

## Configuration

Models can be configured via environment variables:

```bash
# Primary model for high-stakes tasks (default: gpt-5)
PRIMARY_LLM_MODEL=gpt-5

# Lightweight model for simple tasks (default: gpt-4.1-mini)
LIGHT_LLM_MODEL=gpt-4.1-mini

# Reasoning model for complex logical tasks (default: o3-mini)
REASONING_LLM_MODEL=o3-mini
```

## Model Specialties Summary

| Model | Best For | Use When |
|-------|----------|----------|
| **gpt-5** | General purpose, highest quality | Final replies, dataset analysis, complex tasks |
| **gpt-5-mini** | Cost-effective general purpose | Lightweight versions of GPT-5 tasks |
| **o3-mini** | Complex reasoning, logical analysis | Intent parsing, suitability analysis |
| **gpt-4.1** | Structured outputs, reasoning | Intent parsing (fallback), dataset analysis |
| **gpt-4.1-mini** | Cost-effective structured tasks | Card reasons, lightweight structured tasks |
| **gpt-4o** | Fast, multimodal | General purpose (fallback) |
| **gpt-4o-mini** | Fast, cost-effective | Lightweight tasks (fallback) |

## Performance Considerations

1. **Latency**: Reasoning models (o3-mini) may have slightly higher latency but provide better logical analysis.
2. **Cost**: Mini models are significantly cheaper while maintaining good quality for appropriate tasks.
3. **Quality**: GPT-5 provides the best overall quality, while reasoning models excel at logical tasks.
4. **Reliability**: All models have high reliability, but newer models (GPT-5, GPT-4.1) may have better consistency.

## Migration Notes

- Previously used `gpt-4o` and `gpt-4o-mini` as defaults
- Upgraded to `gpt-5` and `gpt-4.1-mini` for better performance
- Added `o3-mini` for reasoning-intensive tasks
- All changes are backward compatible via environment variables



