/**
 * Registry API Types
 */

export interface PublishRequest {
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  version: string;
  content: string;
  contentType?: 'markdown' | 'plain';
  tags?: string[];
  changelog?: string;
}

export interface PublishResponse {
  name: string;
  owner: string;
  version: string;
  visibility: 'public' | 'private';
  publishedAt: string;
}

export interface AgentSummary {
  name: string;
  owner: string;
  description?: string;
  visibility: 'public' | 'private';
  tags: string[];
  latestVersion: string;
  totalDownloads: number;
}

export interface AgentDetail {
  name: string;
  owner: string;
  description?: string;
  visibility: 'public' | 'private';
  tags: string[];
  latestVersion: string;
  latestContent: string;
  contentType: 'markdown' | 'plain';
  totalDownloads: number;
  versions: AgentVersionInfo[];
}

export interface AgentVersionInfo {
  version: string;
  content?: string;
  downloads: number;
  publishedAt: string;
  isLatest: boolean;
}

export interface SearchResult {
  agents: AgentSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ListFilters {
  page?: number;
  limit?: number;
  sort?: 'downloads' | 'newest' | 'name';
  owner?: string;
  tag?: string;
}

export interface RegistryError {
  error: string;
  message: string;
  details?: Record<string, string>;
}
