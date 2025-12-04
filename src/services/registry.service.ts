import {
  AgentDetail,
  AgentVersionInfo,
  ListFilters,
  PublishRequest,
  PublishResponse,
  RegistryError,
  SearchResult,
} from '../types/registry.types.js';
import { getAuthToken, getRegistryUrl } from '../utils/config.js';

/**
 * Registry API Error
 */
export class RegistryApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public details?: Record<string, string>
  ) {
    super(message);
    this.name = 'RegistryApiError';
  }
}

/**
 * Make authenticated request to registry API
 */
const registryFetch = async <T>(
  path: string,
  options: RequestInit = {}
): Promise<T> => {
  const registryUrl = await getRegistryUrl();
  const token = await getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${registryUrl}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as RegistryError;
    throw new RegistryApiError(
      error.message || 'Request failed',
      error.error || 'request_failed',
      response.status,
      error.details
    );
  }

  return data as T;
};

/**
 * Publish an agent to the registry
 */
export const publishAgent = async (
  data: PublishRequest
): Promise<PublishResponse> => {
  const response = await registryFetch<{
    success: boolean;
    agent: PublishResponse;
  }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.agent;
};

/**
 * Get agent details from registry
 */
export const getAgent = async (
  owner: string,
  name: string
): Promise<AgentDetail> => {
  const response = await registryFetch<{ success: boolean; data: AgentDetail }>(
    `/api/agents/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  );
  return response.data;
};

/**
 * Get specific version of an agent
 */
export const getAgentVersion = async (
  owner: string,
  name: string,
  version: string
): Promise<AgentVersionInfo> => {
  const response = await registryFetch<{
    success: boolean;
    data: AgentVersionInfo;
  }>(
    `/api/agents/${encodeURIComponent(owner)}/${encodeURIComponent(
      name
    )}/versions/${encodeURIComponent(version)}`
  );
  return response.data;
};

/**
 * Search for agents in registry
 */
export const searchAgents = async (
  query: string,
  page = 1,
  limit = 10
): Promise<SearchResult> => {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
  });

  const response = await registryFetch<{
    success: boolean;
    data: SearchResult;
  }>(`/api/agents/search?${params.toString()}`);
  return response.data;
};

/**
 * List agents from registry with filters
 */
export const listAgents = async (
  filters: ListFilters = {}
): Promise<SearchResult> => {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.owner) params.set('owner', filters.owner);
  if (filters.tag) params.set('tag', filters.tag);

  const response = await registryFetch<{
    success: boolean;
    data: SearchResult;
  }>(`/api/agents?${params.toString()}`);
  return response.data;
};
