# skill: release-management

## Phase
SHIP

## Purpose
Manage version release and deployment.

## Triggers
- Command: `scale ship release <version>`
- Keywords: release, deploy, version

## Procedure

1. **Create Release Artifact**
   - Set version number
   - Link included Specs/Changes

2. **Choose Strategy**
   - canary: gradual rollout
   - blue_green: instant switch
   - rolling: incremental update

3. **Tag Release**
   - git tag v<version>
   - Push tag to remote

4. **Deploy**
   - Execute deployment pipeline
   - Monitor health metrics

5. **Rollback Ready**
   - Keep rollback script
   - Document rollback steps
