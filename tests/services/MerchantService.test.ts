/**
 * MerchantService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMerchant,
  updateMerchantProfile,
  createMerchantUser,
  getMerchantUsers,
  updateMerchantUser,
  deleteMerchantUser,
} from '@/lib/services/MerchantService';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { encrypt } from '@/lib/encryption';

// Mock dependencies
vi.mock('@/lib/db');
vi.mock('@/lib/auth/password');
vi.mock('@/lib/encryption');

const mockPrisma = vi.mocked(prisma);
const mockHashPassword = vi.mocked(hashPassword);
const mockEncrypt = vi.mocked(encrypt);

describe('MerchantService', () => {
  const mockMerchantId = 'merchant-123';
  const mockMerchant = {
    id: mockMerchantId,
    slug: 'test-merchant',
    name: 'Test Merchant',
    brandName: 'Test Brand',
    primaryColor: '#e11d48',
    accentColor: '#f97373',
    backgroundColor: '#ffffff',
    surfaceColor: '#fff7f7',
    borderColor: '#ffe4e6',
    logoUrl: null,
    voiceInstructions: 'Be helpful',
    toneFormal: 5,
    tonePlayful: 5,
    useMerchantKey: false,
    merchantOpenAIKey: null,
    datasetContext: null,
    shopifyStore: null,
    shopifyAccessToken: null,
    shopifySyncEnabled: false,
    shopifySyncedAt: null,
    reviewProvider: null,
    reviewApiKey: null,
    reviewSyncEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMerchant', () => {
    it('should return merchant when found', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);

      const result = await getMerchant(mockMerchantId);

      expect(result).toEqual(mockMerchant);
      expect(mockPrisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { id: mockMerchantId },
      });
    });

    it('should return null when merchant not found', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(null);

      const result = await getMerchant(mockMerchantId);

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockRejectedValue(new Error('DB error'));

      await expect(getMerchant(mockMerchantId)).rejects.toThrow('Failed to get merchant');
    });
  });

  describe('updateMerchantProfile', () => {
    it('should update merchant profile', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);
      mockPrisma.merchant.update = vi.fn().mockResolvedValue({
        ...mockMerchant,
        brandName: 'Updated Brand',
      });

      const result = await updateMerchantProfile(mockMerchantId, {
        brandName: 'Updated Brand',
      });

      expect(result.brandName).toBe('Updated Brand');
      expect(mockPrisma.merchant.update).toHaveBeenCalledWith({
        where: { id: mockMerchantId },
        data: expect.objectContaining({
          brandName: 'Updated Brand',
          updatedAt: expect.any(Date),
        }),
      });
    });

    it('should encrypt merchantOpenAIKey when provided', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);
      mockEncrypt.mockResolvedValue('encrypted-key');
      mockPrisma.merchant.update = vi.fn().mockResolvedValue({
        ...mockMerchant,
        merchantOpenAIKey: 'encrypted-key',
      });

      await updateMerchantProfile(mockMerchantId, {
        merchantOpenAIKey: 'sk-test-key',
      });

      expect(mockEncrypt).toHaveBeenCalledWith('sk-test-key');
      expect(mockPrisma.merchant.update).toHaveBeenCalledWith({
        where: { id: mockMerchantId },
        data: expect.objectContaining({
          merchantOpenAIKey: 'encrypted-key',
        }),
      });
    });

    it('should throw error when merchant not found', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        updateMerchantProfile(mockMerchantId, { brandName: 'New Name' })
      ).rejects.toThrow('Merchant not found');
    });
  });

  describe('createMerchantUser', () => {
    const mockUser = {
      id: 'user-123',
      merchantId: mockMerchantId,
      email: 'test@example.com',
      passwordHash: 'hashed-password',
      role: 'ADMIN' as const,
      isActive: true,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should create merchant user', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);
      mockPrisma.merchantUser.findFirst = vi.fn().mockResolvedValue(null);
      mockHashPassword.mockResolvedValue('hashed-password');
      mockPrisma.merchantUser.create = vi.fn().mockResolvedValue(mockUser);

      const result = await createMerchantUser(
        mockMerchantId,
        'test@example.com',
        'password123',
        'ADMIN'
      );

      expect(result).toEqual(mockUser);
      expect(mockHashPassword).toHaveBeenCalledWith('password123');
      expect(mockPrisma.merchantUser.create).toHaveBeenCalledWith({
        data: {
          merchantId: mockMerchantId,
          email: 'test@example.com',
          passwordHash: 'hashed-password',
          role: 'ADMIN',
          isActive: true,
        },
      });
    });

    it('should throw error when user already exists', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);
      mockPrisma.merchantUser.findFirst = vi.fn().mockResolvedValue(mockUser);

      await expect(
        createMerchantUser(mockMerchantId, 'test@example.com', 'password123', 'ADMIN')
      ).rejects.toThrow('User with this email already exists');
    });

    it('should throw error when merchant not found', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        createMerchantUser(mockMerchantId, 'test@example.com', 'password123', 'ADMIN')
      ).rejects.toThrow('Merchant not found');
    });
  });

  describe('getMerchantUsers', () => {
    it('should return all users for merchant', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          merchantId: mockMerchantId,
          email: 'user1@example.com',
          passwordHash: 'hash1',
          role: 'ADMIN' as const,
          isActive: true,
          lastLogin: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'user-2',
          merchantId: mockMerchantId,
          email: 'user2@example.com',
          passwordHash: 'hash2',
          role: 'EDITOR' as const,
          isActive: true,
          lastLogin: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.merchantUser.findMany = vi.fn().mockResolvedValue(mockUsers);

      const result = await getMerchantUsers(mockMerchantId);

      expect(result).toEqual(mockUsers);
      expect(mockPrisma.merchantUser.findMany).toHaveBeenCalledWith({
        where: { merchantId: mockMerchantId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateMerchantUser', () => {
    const mockUser = {
      id: 'user-123',
      merchantId: mockMerchantId,
      email: 'test@example.com',
      passwordHash: 'hashed-password',
      role: 'ADMIN' as const,
      isActive: true,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should update merchant user', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockPrisma.merchantUser.update = vi.fn().mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      const result = await updateMerchantUser(mockMerchantId, 'user-123', {
        isActive: false,
      });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.merchantUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          isActive: false,
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw error when user not found', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        updateMerchantUser(mockMerchantId, 'user-123', { isActive: false })
      ).rejects.toThrow('User not found');
    });

    it('should throw error when user belongs to different merchant', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue({
        ...mockUser,
        merchantId: 'other-merchant',
      });

      await expect(
        updateMerchantUser(mockMerchantId, 'user-123', { isActive: false })
      ).rejects.toThrow('User does not belong to this merchant');
    });
  });

  describe('deleteMerchantUser', () => {
    const mockUser = {
      id: 'user-123',
      merchantId: mockMerchantId,
      email: 'test@example.com',
      passwordHash: 'hashed-password',
      role: 'ADMIN' as const,
      isActive: true,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should delete merchant user', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockPrisma.merchantUser.delete = vi.fn().mockResolvedValue(mockUser);

      await deleteMerchantUser(mockMerchantId, 'user-123');

      expect(mockPrisma.merchantUser.delete).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should throw error when user not found', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue(null);

      await expect(deleteMerchantUser(mockMerchantId, 'user-123')).rejects.toThrow(
        'User not found'
      );
    });

    it('should throw error when user belongs to different merchant', async () => {
      mockPrisma.merchantUser.findUnique = vi.fn().mockResolvedValue({
        ...mockUser,
        merchantId: 'other-merchant',
      });

      await expect(deleteMerchantUser(mockMerchantId, 'user-123')).rejects.toThrow(
        'User does not belong to this merchant'
      );
    });
  });
});


