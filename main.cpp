#include <iostream>
#include <fstream>
#include <vector>
#include <chrono>
#include <charconv>
#include <optional>
#include <sstream>

class Entry{
    public:
        std::chrono::sys_seconds timestamp;
        unsigned BG;
        std::string event = "NONE";

    Entry(std::chrono::sys_seconds timestamp, unsigned BG, std::string event = "NONE"){
        this->timestamp = timestamp;
        this->BG = BG;
        this->event = event;
    }
    std::chrono::sys_seconds getTimestamp();
    unsigned getBG();
    
};

// parses CSV date "YYYY/MM/DD" and time "HH:MM:SS"; returns nothing if either is malformed or out of range
std::optional<std::chrono::sys_seconds> toTimestamp(const std::string& date, const std::string& time){
    std::istringstream dateStream(date);
    int year = 0;
    unsigned month = 0, day = 0;
    char sep1 = 0, sep2 = 0;
    dateStream >> year >> sep1 >> month >> sep2 >> day;
    if(!dateStream || sep1 != '/' || sep2 != '/'){
        return std::nullopt;
    }
    std::chrono::year_month_day ymd{std::chrono::year{year}, std::chrono::month{month}, std::chrono::day{day}};
    if(!ymd.ok()){
        return std::nullopt;
    }

    std::istringstream timeStream(time);
    unsigned hour = 0, min = 0, sec = 0;
    char tsep1 = 0, tsep2 = 0;
    timeStream >> hour >> tsep1 >> min >> tsep2 >> sec;
    if(!timeStream || tsep1 != ':' || tsep2 != ':' || hour > 23 || min > 59 || sec > 59){
        return std::nullopt;
    }

    return std::chrono::sys_days{ymd} + std::chrono::hours{hour} + std::chrono::minutes{min} + std::chrono::seconds{sec};
}

int main(int argc, char** argv){

    //declare the input file and line in which we will store each read line
    std::string line;
    std::ifstream inFile("in.csv");

    //loop that finds the first line which contains sensor data, this is marked by the string
    //;Sensor; in that line, after that it reads one more line becaues it s the header and then
    //we can read the actual data
    while(std::getline(inFile, line)){
        if(line.find(";Sensor;")==std::string::npos){
            continue;
        }
        else{
            std::getline(inFile,line);
            break;
        }
    }
    auto entryNo = 0;
    std::vector<std::string> fields;
    std::vector<Entry> entries;

    while(std::getline(inFile,line)){
        entryNo++;
        fields.clear();
        std::size_t start = 0;
        std::size_t semiColonPos;
        while((semiColonPos = line.find(';', start)) != std::string::npos){
            fields.push_back(line.substr(start, semiColonPos - start));
            start = semiColonPos + 1;
        }
        fields.push_back(line.substr(start));

        if(fields.size() < 52 ){
            continue;
        }

        if(fields[34].empty()){
            continue;
        }

        auto timestamp = toTimestamp(fields[1], fields[2]);
        if(!timestamp){
            continue;
        }

        unsigned BG = 0;
        auto [ptr, ec] = std::from_chars(fields[34].data(), fields[34].data() + fields[34].size(), BG);
        if(ec != std::errc{}){
            continue;
        }

        entries.push_back(Entry(*timestamp, BG, !fields[51].empty() ? fields[51] : "NONE"));

    } 

    for(auto it : entries ){
        std::cout << it.BG << " ";
    }

    

    return 0;
}