# LinkedIn Helper beta release

`LinkedIn Helper.zip` is the selected-user beta built by `extensions/linkedin-helper` with `bun run zip`. Include it in a release together with the channel constants and server/UI changes. It must remain outside `public/`.

The authenticated download handler chooses this file only for selected eligible users. Other users receive the existing `public/downloads/crm-hub-linkedin-helper-1.7.0-chrome.zip` unchanged. Both download as `LinkedIn Helper.zip`.

Do not promote stable automatically when updating the beta. Admin enrollment is under `/beta`; a deployment does not enroll users.
