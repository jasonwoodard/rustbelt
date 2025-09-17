### Rust Belt Day Of Information and Decision Support Utilizing the Bayesian Multi-Armed Bandit problem pattern

### Engineering Problem Statement

Problem:

A day of "Thrift Store Banditing" involves visiting a series of locations with unknown but pre-estimated potential for high-quality items. This is a classic multi-armed bandit problem where each store represents a "slot machine" arm. We have a limited resource (time) and must decide at each stop whether to continue "pulling the current arm" (staying and exploring the store beyond the initial 30-minute check-in period) or to "switch arms" (leave the store and move to the next one on the itinerary).

The primary objective is to maximize the overall quality of items found (represented by a cumulative J-Score) over the course of the day, given the time constraints.

Solution:

The proposed application is a decision-support tool that formalizes this problem. At each store, the user provides a Measured Quality Assessment (MQA) within a fixed check-in period. The application then uses this new, observed data to provide a recommendation (Stay or Leave) based on a Bayesian approach that compares the observed MQA against the expected remaining quality of the stores yet to be visited.

This allows the user to make an informed, data-driven decision at each step, moving from a simple static plan to a dynamic, adaptive strategy.

Details:

The decision model is based on a simple heuristic. A simplified Bayesian update is performed where the observed MQA for the current store is compared against the average J-Score of all remaining stores. The MQA values are hardcoded and visible to the user but are not editable. The "J-Score" is a fixed attribute of each store.

-   Expected Remaining Quality (E_rem):\
    E_rem=n∑_i=1nJ_i​\
    where J_i is the J-Score of an unvisited store i and n is the number of remaining stores.

-   Decision Logic: The logic uses a tiered comparison to determine the optimal action.

|

MQA

 |

Comparison with E_rem

 |

Recommendation

 |

Rationale

 |
|

Exceptional

 |

MQAE_rem

 |

Stay

 |

The current store is performing better than the average of all remaining options; it's a "hot arm."

 |
|

Good

 |

MQA≥E_rem

 |

Stay

 |

The store is at or above the expected average. The opportunity cost of leaving is high.

 |
|

Good

 |

MQA\<E_rem

 |

Leave

 |

The expected quality of future stops is higher than what's observed here. Move on.

 |
|

Average

 |

MQA≥E_rem

 |

Stay

 |

It's an average store. The optimal strategy is to stay if it's meeting expectations.

 |
|

Average

 |

MQA\<E_rem

 |

Leave

 |

It's performing below the average of remaining stores. The best path is to move on.

 |
|

Bust

 |

Any

 |

Leave

 |

The store has no value. Cut losses immediately and move on to the next opportunity.

 |

The MQA values are mapped to a quantitative score as follows:

|

MQA

 |

Value

 |
|

Bust

 |

0.0

 |
|

Average

 |

3.5

 |
|

Good

 |

4.2

 |
|

Exceptional

 |

5.0

 |

### Phase 1: Minimum Viable Product (MVP)

Goal: Create a functional core application that loads a pre-generated plan, allows for a single decision, and exports the result.

Use Cases:

-   UC-1.1: User opens a pre-generated HTML itinerary file.

-   UC-1.2: System loads itinerary data from the embedded JSON object.

-   UC-1.3: System displays the current store and an MQA prompt.

-   UC-1.4: User provides an MQA for the current store.

-   UC-1.5: System provides a simple recommendation based on the MQA and expected remaining quality.

-   UC-1.6: User records the decision to either Stay or Leave.

-   UC-1.7: User can export the updated itinerary as a JSON file.

Functional Requirements (FRs):

-   FR-01: The web page shall contain an embedded JSON object with the full itinerary data within a <script> tag with id="itinerary-data".

-   FR-02: Upon page load, the JavaScript shall parse the embedded JSON and load it into a data structure in memory.

-   FR-03: The page shall display the name of the first store on the itinerary.

-   FR-04: The page shall display a dashboard showing the Total Itinerary Stores, Stores Visited, and the Overall Average J-Score.

-   FR-05: The page shall display a dropdown or radio buttons for the user to select the MQA: Bust, Average, Good, or Exceptional.

-   FR-06: The page shall calculate and display the Expected Remaining Quality (average J-Score of unvisited stores).

-   FR-07: The page shall have a button to process the MQA and display the decision.

-   FR-08: Based on the MQA and the Expected Remaining Quality, the page shall display a clear, bold recommendation: Stay or Leave, referencing the logic from our decision table.

-   FR-09: A button shall be available to export the final state of the itinerary as a JSON file that the user can download.

### Phase 2: Core Improvements

Goal: Enhance the core application by implementing the "overrun" logic, providing more dynamic feedback, and improving data capture for post-trip analysis.

Use Cases:

-   UC-2.1: User decides to stay at a store, and the system automatically updates the itinerary.

-   UC-2.2: User can see a simplified history of their decisions for the day.

-   UC-2.3: System automatically advances to the next store on the list after a decision is made.

-   UC-2.4: User can mark a store as a "bust" and immediately move on.

Functional Requirements (FRs):

-   FR-10: When the user's MQA is "Exceptional" and the recommendation is to Stay, the system shall automatically identify the lowest-scoring store in the remaining itinerary.

-   FR-11: The system shall prompt the user with a confirmation dialog asking if they want to drop the lowest-scoring store.

-   FR-12: Upon confirmation, the system shall change the Status of the dropped store to Dropped and update the Expected Remaining Quality accordingly.

-   FR-12.1: The page shall display a simple visual timeline for each store, showing the user's Arrive time, the end of the MQA check-in period, and the Decision point.

-   FR-13: The page shall automatically advance to the next store on the itinerary after a decision is recorded.

-   FR-14: A "Bust" button shall be available on the page to provide a quick exit. Clicking it shall automatically record the MQA as Bust, set the decision to Leave, and advance to the next store.

-   FR-15: The page shall include a simple, scrollable Trip Log that displays the Store Name, MQA, and Decision for each store visited.

### Phase 3: Advanced Features

Goal: Add "nice-to-have" functionality to provide more utility and configurability, moving toward a more polished and complete tool.

Use Cases:

-   UC-3.1: User can see a more detailed visual representation of their plan.

-   UC-3.2: System can dynamically update the average expected quality based on real-time observations.

-   UC-3.3: User can adjust key parameters.

Functional Requirements (FRs):

-   FR-16: The system shall display the itinerary as a dynamic list. Stores shall be grayed out as their Status changes to Visited or Dropped.

-   FR-17: The system shall use the quantitative MQA values to create a "Bayesian adjustment factor" and dynamically lower or raise the Expected Remaining Quality based on the average MQA of stores visited so far.

-   FR-18: A settings or configuration section shall be available to allow the user to change the quantitative MQA values.

-   FR-19: The final output file shall include a summary section at the top with metrics from the trip, such as Total Stores Visited, Average Observed Quality, and Final Remaining Quality.

### Technical Implementation

Architecture: A single, self-contained HTML file will serve as the entry point, containing a <script> tag with the itinerary data. A separate, linked JavaScript file will contain all the application logic and will be shared across all generated itinerary HTML files.

Implementation Details:

-   Data Structure: The core data will be a JavaScript object or array of objects loaded directly from a <script type="application/json"> tag within the HTML. This tag will be given a specific ID (e.g., itinerary-data).\
    <script id="itinerary-data" type="application/json">\
    {\
      "runId": "CL-v1",\
      "days": [\
        {\
          "dayId": "Wed",\
          "stops": [\
            { "id": "TVAT", "name": "The Vault...", "score": 4.3 },\
            ...\
          ]\
        }\
      ]\
    }\
    </script>

-   Data Loading: The main JavaScript file will access the JSON data on page load using document.getElementById('itinerary-data').textContent and then parse it with JSON.parse().

-   Element IDs: To ensure the JavaScript can reliably target and update HTML elements, the Mustache template will use a simple and consistent ID naming convention. For example:

-   id="current-store-name" for displaying the current store.

-   id="dashboard-total-stores" for displaying the total store count.

-   id="mqa-select" for the dropdown input.

-   id="decision-button" for the Process MQA button.

-   id="row-$storeId" for a specific <td> or <tr> element for a store, where $storeId is a unique identifier from the JSON data.

-   Decision Logic: The logic will be implemented in vanilla JavaScript. The core calculation for the recommendation will compare the user's MQA against the Expected Remaining Quality of the itinerary.

-   State Management: The application's state will be managed in a simple JavaScript object in the main JS file. This object will hold the current itinerary, the current store index, and a log of decisions.

-   Output Generation: The export functionality will use JavaScript's Blob API to create a file from a string. A link will be created with URL.createObjectURL and a download attribute to trigger the file download.

-   DOM Manipulation:  document.getElementById() and textContent or innerHTML will be used to dynamically update the dashboard and other UI elements based on the state. For updating specific store rows, the compound IDs (e.g., row-TVAT) will be used to select the correct elements.

Non-Functional Requirements (NFRs):

-   NFR-01: The application shall run entirely on the client-side, requiring no internet connection after the initial page load.

-   NFR-02: The application shall be a single HTML file with embedded JSON and a single, separately loaded JavaScript file for easy portability.

-   NFR-03: The application shall have a mobile-first, responsive design to ensure a good experience on a tablet.

-   NFR-04: The file I/O operations shall be performed without requiring server communication.

-   NFR-05: The solution assumes a new HTML file will be generated for each trip, which will always load the latest version of the JavaScript application file.