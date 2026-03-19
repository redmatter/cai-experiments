import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

/**
 * Gets AWS credentials from SSO profile.
 * Before using, ensure you've run: aws sso login --sso-session sso-main
 */
export async function getAwsCredentials(
  profile: string = 'sso-qa02-admin'
): Promise<AwsCredentialIdentity> {
  console.log(`✅ Getting AWS credentials from profile: ${profile}`);

  try {
    const credentialProvider = fromIni({ profile });
    const credentials = await credentialProvider();

    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  } catch (error) {
    console.error('❌ Failed to get AWS credentials. Have you run "aws sso login --sso-session sso-main"?');
    throw error;
  }
}