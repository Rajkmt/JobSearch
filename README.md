Automated Job Search Aggregator built with Node.js and Docker. This project collects job listings from LinkedIn and Google using Google CSE, processes and merges results, and delivers them to an N8N webhook. Includes CSV export for analysis. Portable via Docker for easy deployment on any system.

## Features

- ⚡ Lightening Fast
- ✨ Minimal
- 🪶 Lightweight
- 🔥 Advanced Filters
- 🤩 Support all Frameworks

## How to Install ?

Use npm or yarn to install this npm package

```
npm i linkedin-jobs-api
```

or

```
yarn add linkedin-jobs-api
```

Include the package

```
const linkedIn = require('linkedin-jobs-api');
```

Basic Example:

```
const linkedIn = require('linkedin-jobs-api');

const queryOptions = {
  keyword: 'software engineer',
  location: 'India',
  dateSincePosted: 'past Week',
  jobType: 'full time',
  remoteFilter: 'remote',
  salary: '100000',
  experienceLevel: 'entry level',
  limit: '10',
  page: "0",
  has_verification: false,
  under_10_applicants: false,
};

linkedIn.query(queryOptions).then(response => {
	console.log(response); // An array of Job objects
});
```

## Query Object Parameters

query() accepts a _queryOptions_ object and returns an array of _Job_ objects.

|    Parameter    | LinkedIn Default value |                                                Description                                                |
| :-------------: | :--------------------: | :-------------------------------------------------------------------------------------------------------: |
|     keyword     |           ""           |                         _string_ - The text to search: (i.e. Software Developer)                          |
|    location     |           ""           |                            _string_ - The name of the city: (i.e. Los Angeles)                            |
| dateSincePosted |           ""           |                      _string_ - Max range of jobs: `past month`, `past week`, `24hr`                      |
|     jobType     |           ""           | _string_ - Type of position: `full time`, `part time`, `contract`, `temporary`, `volunteer`, `internship` |
|  remoteFilter   |           ""           |                      _string_ - Filter telecommuting: `on site`, `remote`, `hybrid`                       |
|     salary      |           ""           |                 _string_ - Minimum Salary: `40000`, `60000`, `80000`, `100000`, `120000`                  |
| experienceLevel |           ""           |          _string_ - `internship`, `entry level`, `associate`, `senior`, `director`, `executive`           |
|      limit      |           ""           |                     _string_ - Number of jobs returned: (i.e. '1', '10', '100', etc)                      |
|     sortBy      |           ""           |                                      _string_ - `recent`, `relevant`                                      |
|     page      |           "0"           |                                      _string_ - `0`, `1`, `2` ....                                         |
|has_verification |         `false`        |                                     _boolean_ - `true` / `false`                                          |
| under_10_applicants | `false`            | _boolean_ `true` / `false`                                                                                |
## Job Objects

|  Paramter   |     Description (Default: null)     |
| :---------: | :---------------------------------: |
|  position   |      _string_ - Position title      |
|   company   |       _string_ - Company name       |
| companyLogo |       _string_ - Company Logo       |
|  location   |   _string_ - Location of the job    |
|    date     | _string_ - Date the job was posted  |
|   agoTime   | _string_ - time since it was posted |
|   salary    |       _string_ - Salary range       |
|   jobUrl    |   _string_ - URL of the job page    |


```


## Contributing

Feel free to contribute!

1. Fork the repository
2. Make changes
3. Submit a pull request

# upload to n8n combined result --> npm run delivery
# npm run linkedin

# npm run both:seq

# or parallel
# npm run both:parallel
# npm run both:deliver
# npm run both:one  --> for running both 
# npm run delivery --> for just to upload to n8n  
