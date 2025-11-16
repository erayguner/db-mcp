import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Google Workspace OIDC Authentication
 * Validates OIDC tokens from Google Workspace users
 */

export const GoogleWorkspaceConfigSchema = z.object({
  clientId: z.string(),
  hostedDomain: z.string(),
  allowedGroups: z.array(z.string()).optional(),
});

export type GoogleWorkspaceConfig = z.infer<typeof GoogleWorkspaceConfigSchema>;

export interface WorkspaceUser {
  email: string;
  name: string;
  hostedDomain: string;
  emailVerified: boolean;
  subject: string;
  groups?: string[];
}

export class GoogleWorkspaceAuth {
  private client: OAuth2Client;
  private config: GoogleWorkspaceConfig;

  constructor(config: GoogleWorkspaceConfig) {
    this.config = GoogleWorkspaceConfigSchema.parse(config);
    this.client = new OAuth2Client(this.config.clientId);

    logger.info('Google Workspace authentication initialized', {
      domain: this.config.hostedDomain,
    });
  }

  /**
   * Verify and decode Google Workspace OIDC token
   */
  async verifyToken(idToken: string): Promise<WorkspaceUser> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.clientId,
      });

      const payload = ticket.getPayload();
      
      if (!payload) {
        throw new Error('Invalid token payload');
      }

      // Verify hosted domain
      if (payload.hd !== this.config.hostedDomain) {
        throw new Error(`Invalid hosted domain: ${payload.hd}`);
      }

      // Verify email is verified
      if (!payload.email_verified) {
        throw new Error('Email not verified');
      }

      const user: WorkspaceUser = {
        email: payload.email!,
        name: payload.name!,
        hostedDomain: payload.hd!,
        emailVerified: payload.email_verified!,
        subject: payload.sub!,
        groups: (payload as any).groups as string[] | undefined,
      };

      // Check group membership if configured
      if (this.config.allowedGroups && this.config.allowedGroups.length > 0) {
        if (!user.groups || !this.hasAllowedGroup(user.groups)) {
          throw new Error('User not in allowed groups');
        }
      }

      logger.info('Google Workspace token verified', {
        email: user.email,
        domain: user.hostedDomain,
      });

      return user;
    } catch (error) {
      logger.error('Google Workspace token verification failed', { error });
      throw new Error(`Token verification failed: ${error}`);
    }
  }

  /**
   * Extract user info from verified token
   */
  async getUserInfo(idToken: string): Promise<WorkspaceUser> {
    return this.verifyToken(idToken);
  }

  /**
   * Check if user has any allowed group
   */
  private hasAllowedGroup(userGroups: string[]): boolean {
    if (!this.config.allowedGroups) return true;
    
    return this.config.allowedGroups.some(allowedGroup =>
      userGroups.includes(allowedGroup)
    );
  }

  /**
   * Validate domain
   */
  validateDomain(email: string): boolean {
    const domain = email.split('@')[1];
    return domain === this.config.hostedDomain;
  }
}
