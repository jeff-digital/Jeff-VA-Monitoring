package com.jeffdigital.jeffva;

import org.json.JSONObject;

/** Synthetic UI fixture. Entry is compiled out of the release build. */
final class PreviewData {
    static JSONObject workspace() throws Exception {
        String today = WorkspaceModel.today();
        return new JSONObject("{\"applications\":[{\"id\":\"sample-client\",\"clientName\":\"Northstar Studio\",\"contact\":\"Alex\",\"role\":\"Social media assistant\",\"status\":\"Active client\",\"contractStatus\":\"Active\",\"salaryAmount\":1200,\"salaryCurrency\":\"USD\",\"salaryType\":\"Monthly\",\"documents\":[]},{\"id\":\"sample-application\",\"clientName\":\"Brightside Co.\",\"role\":\"Virtual assistant\",\"status\":\"Interview\",\"appliedDate\":\"" + today + "\"}],\"dailyTasks\":[{\"id\":\"sample-task\",\"title\":\"Prepare weekly content schedule\",\"taskDate\":\"" + today + "\",\"relatedName\":\"Northstar Studio\",\"completedAt\":\"\",\"checklist\":[]}],\"clientTasks\":[{\"id\":\"sample-client-task\",\"clientId\":\"sample-client\",\"title\":\"Review draft captions\",\"status\":\"todo\",\"priority\":\"Medium\",\"dueDate\":\"" + today + "\",\"timeEntries\":[]}],\"walletEntries\":[{\"id\":\"sample-income\",\"description\":\"Client payment\",\"type\":\"income\",\"account\":\"wise\",\"cents\":120000,\"date\":\"" + today + "\"}],\"subscriptions\":[{\"id\":\"sample-sub\",\"name\":\"Design workspace\",\"account\":\"Personal\",\"expiryDate\":\"2027-01-31\"}],\"emails\":[{\"id\":\"sample-email\",\"subject\":\"Content plan for next week\",\"from\":\"Alex <alex@example.com>\",\"body\":\"Let's review the content schedule tomorrow.\",\"direction\":\"received\",\"date\":\"" + today + "\"}]}");
    }
}
