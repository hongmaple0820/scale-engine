/**
 * Open Verification Protocol — JSON Schema for verification.json
 *
 * This defines the standard protocol that third-party tools can use
 * to integrate with SCALE's evidence system.
 *
 * Version: 1.0.0
 */

export const VERIFICATION_PROTOCOL_VERSION = '1.0.0'

export interface VerificationProtocol {
  $schema: string
  version: string
  project: {
    name: string
    language: string
    framework?: string
  }
  profiles: Record<string, VerificationProfileProtocol>
  /** Third-party tool integrations */
  integrations?: Array<{
    tool: string
    type: 'test-runner' | 'linter' | 'security-scanner' | 'coverage' | 'custom'
    adapter: {
      command: string
      outputFormat: 'json' | 'junit' | 'sarif' | 'custom'
      exitCodeMapping: { pass: number[]; fail: number[] }
    }
  }>
}

export interface VerificationProfileProtocol {
  description: string
  services: Record<string, {
    type: 'node' | 'go' | 'python' | 'custom'
    commands: Record<string, string>
    policy: {
      mode: 'minimal' | 'standard' | 'critical'
      artifactGate: 'off' | 'warn' | 'block'
      engineeringStandardsGate: 'off' | 'warn' | 'block'
      productSmokeGate: 'off' | 'warn' | 'block'
      ecosystemReadinessGate?: 'off' | 'warn' | 'block'
      ecosystemReadinessPacks?: string[]
      ecosystemReadinessSkillScope?: 'required' | 'recommended' | 'all'
    }
  }>
}

export function generateVerificationSchema(): object {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://scale-engine.dev/verification-protocol-v1.schema.json',
    title: 'SCALE Verification Protocol',
    type: 'object',
    required: ['version', 'project', 'profiles'],
    properties: {
      version: { type: 'string', const: '1.0.0' },
      project: {
        type: 'object',
        required: ['name', 'language'],
        properties: {
          name: { type: 'string' },
          language: { type: 'string', enum: ['node', 'go', 'python', 'rust', 'java', 'other'] },
          framework: { type: 'string' },
        },
      },
      profiles: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['services'],
          properties: {
            description: { type: 'string' },
            services: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                required: ['type', 'commands'],
                properties: {
                  type: { type: 'string', enum: ['node', 'go', 'python', 'custom'] },
                  commands: {
                    type: 'object',
                    properties: {
                      build: { type: 'string' },
                      lint: { type: 'string' },
                      test: { type: 'string' },
                      coverage: { type: 'string' },
                      smoke: { type: 'string' },
                    },
                  },
                  policy: {
                    type: 'object',
                    properties: {
                      mode: { type: 'string', enum: ['minimal', 'standard', 'critical'] },
                      artifactGate: { type: 'string', enum: ['off', 'warn', 'block'] },
                      engineeringStandardsGate: { type: 'string', enum: ['off', 'warn', 'block'] },
                      productSmokeGate: { type: 'string', enum: ['off', 'warn', 'block'] },
                      ecosystemReadinessGate: { type: 'string', enum: ['off', 'warn', 'block'] },
                      ecosystemReadinessPacks: {
                        type: 'array',
                        items: { type: 'string', enum: ['ui', 'memory', 'knowledge', 'external-cli', 'full'] },
                      },
                      ecosystemReadinessSkillScope: { type: 'string', enum: ['required', 'recommended', 'all'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      integrations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tool', 'type', 'adapter'],
          properties: {
            tool: { type: 'string' },
            type: { type: 'string', enum: ['test-runner', 'linter', 'security-scanner', 'coverage', 'custom'] },
            adapter: {
              type: 'object',
              required: ['command', 'outputFormat', 'exitCodeMapping'],
              properties: {
                command: { type: 'string' },
                outputFormat: { type: 'string', enum: ['json', 'junit', 'sarif', 'custom'] },
                exitCodeMapping: {
                  type: 'object',
                  required: ['pass', 'fail'],
                  properties: {
                    pass: { type: 'array', items: { type: 'number' } },
                    fail: { type: 'array', items: { type: 'number' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}
