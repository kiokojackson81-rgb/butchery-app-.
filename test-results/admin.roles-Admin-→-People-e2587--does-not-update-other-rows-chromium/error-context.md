# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - main [ref=e12]:
    - generic [ref=e13]:
      - generic [ref=e14]:
        - heading "Admin Login" [level=1] [ref=e15]
        - paragraph [ref=e16]: Sign in to access the control room.
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: Email
          - textbox "Enter admin email" [ref=e20]
        - generic [ref=e21]:
          - generic [ref=e22]: Password
          - generic [ref=e23]:
            - textbox "Enter password" [ref=e24]
            - button "Show" [ref=e25] [cursor=pointer]
        - button "Sign in" [ref=e26] [cursor=pointer]
      - generic [ref=e27]:
        - text: This login only protects the
        - code [ref=e28]: /admin
        - text: section. Attendant/Supervisor areas are unaffected.
```