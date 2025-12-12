import { prisma } from '../db';
import { logger } from './logger';

export type ConversationEventPayload = {
  merchantId: string;
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  userQuery: string;
  assistantReply: string;
  productIds: string[];
  hadExactMatch: boolean;
};

const TRUNCATE_LENGTH = 256;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export async function recordConversationEvent(payload: ConversationEventPayload) {
  try {
    const truncatedQuery = truncate(payload.userQuery.trim(), TRUNCATE_LENGTH);
    const truncatedReply = truncate(payload.assistantReply, TRUNCATE_LENGTH);

    await prisma.conversationEvent.create({
      data: {
        id: crypto.randomUUID(),
        merchant: { connect: { id: payload.merchantId } },
        sessionId: payload.sessionId,
        pageType: payload.pageType,
        userQuery: truncatedQuery,
        assistantReplySnippet: truncatedReply || null,
        productIds: payload.productIds,
        hadExactMatch: payload.hadExactMatch,
        clicked: false,
      },
    });

    logger.info('conversation_event_recorded', {
      sessionId: payload.sessionId,
      productCount: payload.productIds.length,
      hadExactMatch: payload.hadExactMatch,
    });
  } catch (error) {
    logger.error('failed_to_record_conversation_event', {
      error: error instanceof Error ? error.message : String(error),
      sessionId: payload.sessionId,
    });
  }
}

export async function recordProductClick(sessionId: string, productId: string) {
  try {
    // Find the most recent event for this session that includes this product
    const eventWithProduct = await prisma.conversationEvent.findFirst({
      where: {
        sessionId,
        productIds: {
          has: productId,
        },
        clicked: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (eventWithProduct) {
      await prisma.conversationEvent.update({
        where: { id: eventWithProduct.id },
        data: {
          clicked: true,
          clickedProductId: productId,
        },
      });

      logger.info('product_click_recorded', {
        sessionId,
        productId,
        eventId: eventWithProduct.id,
      });
      return;
    }

    // Fallback: mark most recent event for this session as clicked
    const mostRecentEvent = await prisma.conversationEvent.findFirst({
      where: {
        sessionId,
        clicked: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (mostRecentEvent) {
      await prisma.conversationEvent.update({
        where: { id: mostRecentEvent.id },
        data: {
          clicked: true,
          clickedProductId: productId,
        },
      });

      logger.info('product_click_recorded_fallback', {
        sessionId,
        productId,
        eventId: mostRecentEvent.id,
      });
    } else {
      logger.warn('product_click_no_event_found', {
        sessionId,
        productId,
      });
    }
  } catch (error) {
    logger.error('failed_to_record_product_click', {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      productId,
    });
  }
}

