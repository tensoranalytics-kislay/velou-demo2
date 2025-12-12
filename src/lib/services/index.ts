/**
 * Services Layer
 * 
 * Centralized export for all service modules.
 * 
 * This services layer abstracts business logic from API routes,
 * providing clean, testable interfaces for all operations.
 * 
 * All services are scoped to merchantId for multi-tenant isolation.
 */

export * from './MerchantService';
export * from './CatalogService';
export * from './SearchService';
export * from './AssistantService';
export * from './AnalyticsService';
export * from './IntegrationService';


