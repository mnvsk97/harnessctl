---
name: linear
description: Use Symphony's linear_graphql tool for Linear reads and writes.
---

# Linear GraphQL

Use this skill during Symphony app-server sessions when the `linear_graphql`
client tool is available. It reuses Symphony's configured Linear credentials.

Tool input:

```json
{
  "query": "query or mutation document",
  "variables": {
    "id": "..."
  }
}
```

## Rules

- Send one GraphQL operation per tool call.
- Treat a top-level `errors` array as a failed operation.
- Request only the fields you need.
- Prefer exact issue lookup by key, then internal id.
- For state transitions, fetch team states and use the exact `stateId`.
- Reuse and edit the single `## Symphony Workpad` comment.

## Useful Queries

Read an issue:

```graphql
query IssueByKey($key: String!) {
  issue(id: $key) {
    id
    identifier
    title
    url
    description
    branchName
    state {
      id
      name
      type
    }
    project {
      id
      name
      url
    }
    attachments {
      nodes {
        id
        title
        url
        sourceType
      }
    }
    comments {
      nodes {
        id
        body
        resolvedAt
        createdAt
        updatedAt
      }
    }
  }
}
```

Fetch team states:

```graphql
query IssueTeamStates($id: String!) {
  issue(id: $id) {
    id
    team {
      id
      key
      states {
        nodes {
          id
          name
          type
        }
      }
    }
  }
}
```

Move an issue:

```graphql
mutation MoveIssue($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue {
      id
      identifier
      state {
        id
        name
      }
    }
  }
}
```

Create a comment:

```graphql
mutation CreateComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment {
      id
      url
    }
  }
}
```

Update a comment:

```graphql
mutation UpdateComment($id: String!, $body: String!) {
  commentUpdate(id: $id, input: { body: $body }) {
    success
    comment {
      id
      body
    }
  }
}
```

Attach a GitHub PR:

```graphql
mutation AttachGitHubPR($issueId: String!, $url: String!, $title: String) {
  attachmentLinkGitHubPR(
    issueId: $issueId
    url: $url
    title: $title
    linkKind: links
  ) {
    success
    attachment {
      id
      title
      url
    }
  }
}
```
